import type { CandleInterval } from "../types/marketData";
import type { Scan } from "../utils/setupAnalysis";
import { buildScan } from "../utils/setupAnalysis";
import {
  FIRINGS_STORAGE_KEY,
  MAX_FIRINGS,
  MAX_RULES,
  RULES_STORAGE_KEY,
  matchFirings,
  newRuleId,
  parseFirings,
  parseRules,
  resolveOutcome,
  toTrigger,
  type Delivery,
  type SetupAlertFiring,
  type SetupAlertRule,
} from "../utils/setupAlerts";
import { loadWatchlist } from "../utils/watchlistStorage";
import { HistoryService, RESEARCH_UNIVERSE } from "./HistoryService";

export type TelegramStatus = "unknown" | "configured" | "notConfigured" | "offline";

export interface SetupAlertSnapshot {
  rules: SetupAlertRule[];
  firings: SetupAlertFiring[];
  telegram: TelegramStatus;
  lastCheckAt: number | null;
  checking: boolean;
}

export interface SetupAlertDeps {
  /** Pooled scan for one interval; `sig` changes whenever the underlying history does. */
  scanFor: (interval: CandleInterval) => Promise<{ scan: Scan; sig: string }>;
  /** JSON request to the backend (dev proxy `/api` → :3001). Throws when unreachable. */
  request: (path: string, init?: RequestInit) => Promise<unknown>;
  watchlist: () => string[];
  now: () => number;
  storage: Pick<Storage, "getItem" | "setItem"> | null;
}

const CHECK_EVERY_MS = 60_000;

async function defaultScanFor(interval: CandleInterval) {
  const symbols = [...new Set([...loadWatchlist(), ...RESEARCH_UNIVERSE])];
  const svc = HistoryService.getInstance();
  const loaded = await Promise.allSettled(symbols.map((s) => svc.load(s, interval)));
  const histories = loaded.flatMap((r) =>
    r.status === "fulfilled" && r.value.candles.length > 0
      ? [{ symbol: r.value.symbol, candles: r.value.candles }]
      : [],
  );
  const sig = histories.map((h) => `${h.symbol}:${h.candles.length}`).join(",");
  return { scan: buildScan(histories), sig };
}

async function defaultRequest(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) throw new Error(`backend HTTP ${res.status}`);
  return res.json();
}

function browserStorage(): SetupAlertDeps["storage"] {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * Runs setup alerts in the browser while a TCS tab is open (Phase 1a). Each check
 * reuses cached history until a new candle closes, matches rules against the setups
 * detected now, tracks the outcome of earlier firings, and sends Telegram messages
 * through the backend prototype when it runs. Phase 1b moves all of this server-side.
 */
export class SetupAlertService {
  private static instance: SetupAlertService | null = null;
  private listeners = new Set<() => void>();
  private snap: SetupAlertSnapshot;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastSig = new Map<CandleInterval, string>();
  private running: Promise<void> | null = null;
  private deps: SetupAlertDeps;

  constructor(deps: Partial<SetupAlertDeps> = {}) {
    this.deps = {
      scanFor: defaultScanFor,
      request: defaultRequest,
      watchlist: loadWatchlist,
      now: Date.now,
      storage: browserStorage(),
      ...deps,
    };
    this.snap = {
      rules: parseRules(this.read(RULES_STORAGE_KEY)),
      firings: parseFirings(this.read(FIRINGS_STORAGE_KEY)),
      telegram: "unknown",
      lastCheckAt: null,
      checking: false,
    };
  }

  static getInstance(): SetupAlertService {
    if (!SetupAlertService.instance) SetupAlertService.instance = new SetupAlertService();
    return SetupAlertService.instance;
  }

  static resetInstance() {
    SetupAlertService.instance?.stop();
    SetupAlertService.instance = null;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getSnapshot = (): SetupAlertSnapshot => this.snap;

  /** Start the periodic check (idempotent). Returns a stop function. */
  start(): () => void {
    if (!this.timer) {
      void this.refreshTelegramStatus();
      void this.check();
      this.timer = setInterval(() => void this.check(), CHECK_EVERY_MS);
    }
    return () => this.stop();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  addRule(rule: Omit<SetupAlertRule, "id" | "createdAt" | "paused">): SetupAlertRule | null {
    if (this.snap.rules.length >= MAX_RULES) return null;
    const now = this.deps.now();
    const full: SetupAlertRule = { ...rule, id: newRuleId(now), createdAt: now, paused: false };
    this.update({ rules: [...this.snap.rules, full] });
    void this.check();
    return full;
  }

  removeRule(id: string) {
    this.update({ rules: this.snap.rules.filter((r) => r.id !== id) });
  }

  setPaused(id: string, paused: boolean) {
    this.update({ rules: this.snap.rules.map((r) => (r.id === id ? { ...r, paused } : r)) });
  }

  /** Hide firings from the in-app banner (all when no id is given). */
  dismiss(id?: string) {
    this.update({
      firings: this.snap.firings.map((f) =>
        id === undefined || f.id === id ? { ...f, unseen: false } : f,
      ),
    });
  }

  async refreshTelegramStatus(): Promise<TelegramStatus> {
    let telegram: TelegramStatus;
    try {
      const body = (await this.deps.request("/telegram/config")) as { configured?: unknown };
      telegram = body.configured === true ? "configured" : "notConfigured";
    } catch {
      telegram = "offline";
    }
    this.update({ telegram });
    return telegram;
  }

  /** Send a sample message so the owner can confirm delivery works. */
  async sendTest(): Promise<Delivery> {
    const now = this.deps.now();
    return this.deliver({
      ruleId: "test",
      ruleName: "Test message",
      firedAt: now,
      values: {},
      reason: "TCS can reach this chat. Setup alerts will arrive here with their track record.",
    });
  }

  /** One pass over every interval that has an active rule. Concurrent calls share a run. */
  check(): Promise<void> {
    if (!this.running) {
      this.running = this.runCheck().finally(() => {
        this.running = null;
      });
    }
    return this.running;
  }

  private async runCheck() {
    const intervals = [
      ...new Set([
        ...this.snap.rules.filter((r) => !r.paused).map((r) => r.interval),
        ...this.snap.firings.filter((f) => f.outcome === "open").map((f) => f.interval),
      ]),
    ];
    if (intervals.length === 0) return;
    this.update({ checking: true });
    const fresh: SetupAlertFiring[] = [];
    let firings = this.snap.firings;
    for (const interval of intervals) {
      let result: { scan: Scan; sig: string };
      try {
        result = await this.deps.scanFor(interval);
      } catch {
        continue; // history unavailable; try again next check
      }
      if (this.lastSig.get(interval) === result.sig) continue;
      this.lastSig.set(interval, result.sig);
      firings = firings.map((f) =>
        f.interval === interval && f.outcome === "open"
          ? { ...f, outcome: resolveOutcome(f, result.scan) }
          : f,
      );
      const known = new Set([...firings, ...fresh].map((f) => f.id));
      fresh.push(
        ...matchFirings(
          this.snap.rules,
          result.scan.current,
          interval,
          this.deps.watchlist(),
          known,
          this.deps.now(),
        ),
      );
    }
    this.update({
      firings: [...fresh, ...firings].slice(0, MAX_FIRINGS),
      checking: false,
      lastCheckAt: this.deps.now(),
    });
    for (const f of fresh.filter((x) => x.telegram !== "off")) {
      const telegram = await this.deliver(toTrigger(f));
      this.update({
        firings: this.snap.firings.map((x) => (x.id === f.id ? { ...x, telegram } : x)),
      });
    }
  }

  private async deliver(trigger: ReturnType<typeof toTrigger>): Promise<Delivery> {
    try {
      const body = (await this.deps.request("/alerts/send", {
        method: "POST",
        body: JSON.stringify({ trigger }),
      })) as { success?: unknown };
      return body.success === true ? "sent" : "failed";
    } catch {
      this.update({ telegram: "offline" });
      return "offline";
    }
  }

  private update(patch: Partial<SetupAlertSnapshot>) {
    this.snap = { ...this.snap, ...patch };
    if (patch.rules) this.write(RULES_STORAGE_KEY, this.snap.rules);
    if (patch.firings) this.write(FIRINGS_STORAGE_KEY, this.snap.firings);
    for (const l of this.listeners) l();
  }

  private read(key: string): unknown {
    try {
      const raw = this.deps.storage?.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  private write(key: string, value: unknown) {
    try {
      this.deps.storage?.setItem(key, JSON.stringify(value));
    } catch {
      // Storage full or blocked: alerts keep working for this session.
    }
  }
}
