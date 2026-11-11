import type { AnalysisOut, ScannerOut } from "../api/schema";
import { apiGet } from "../api/client";
import type { CandleInterval } from "../types/marketData";
import type { SetupOccurrence } from "../types/analysis";
import { normalizeSetupKey, toStats } from "../utils/setupKeys";
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
  type CurrentSetup,
  type Delivery,
  type SetupAlertFiring,
  type SetupAlertRule,
} from "../utils/setupAlerts";
import { loadWatchlist } from "../utils/watchlistStorage";
import { BRAND } from "../brand";

export type TelegramStatus = "unknown" | "configured" | "notConfigured" | "offline";

export interface SetupAlertSnapshot {
  rules: SetupAlertRule[];
  firings: SetupAlertFiring[];
  telegram: TelegramStatus;
  lastCheckAt: number | null;
  checking: boolean;
}

export interface SetupAlertDeps {
  /** Setups on the last closed candles (backend scanner); `sig` changes when they do. */
  scanFor: (
    interval: CandleInterval,
    watchlist: string[],
  ) => Promise<{ current: CurrentSetup[]; sig: string }>;
  /** A coin's recent occurrences with their outcomes so far (to track fired alerts). */
  occurrencesFor: (symbol: string, interval: CandleInterval) => Promise<SetupOccurrence[]>;
  /** JSON request to the backend (dev proxy `/api` → :3001). Throws when unreachable. */
  request: (path: string, init?: RequestInit) => Promise<unknown>;
  watchlist: () => string[];
  now: () => number;
  storage: Pick<Storage, "getItem" | "setItem"> | null;
}

const CHECK_EVERY_MS = 60_000;

/** Alerts use same-timeframe levels: a rule names a timeframe, not a level source. */
async function defaultScanFor(interval: CandleInterval, watchlist: string[]) {
  const body = await apiGet<ScannerOut>("/scanner", {
    tf: interval,
    zoneTf: interval,
    symbols: watchlist.join(","),
    bars: 3,
  });
  const current: CurrentSetup[] = body.items.map((i) => {
    const o: SetupOccurrence = { ...i.occurrence, symbol: i.symbol };
    return {
      occurrence: o,
      pooled: i.pooled ? toStats(o.pattern, o.direction, o.location, i.pooled) : null,
    };
  });
  const sig = current
    .map((c) => `${c.occurrence.symbol}:${c.occurrence.pattern}:${c.occurrence.time}`)
    .join(",");
  return { current, sig: `${body.run?.finishedAt ?? 0}|${sig}` };
}

async function defaultOccurrencesFor(symbol: string, interval: CandleInterval) {
  const a = await apiGet<AnalysisOut>(`/analysis/${symbol}`, {
    tf: interval,
    zoneTf: interval,
    limit: 500,
  });
  return a.occurrences.map((o) => ({ ...o, symbol }));
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
 * Runs setup alerts while a GreenMTM tab is open. Each check asks the analysis service
 * (Python) which setups confirmed on the last closed candles, matches rules against
 * them, tracks the outcome of earlier firings, and sends Telegram messages through
 * the Node backend prototype when it runs. Server-side alerts come later (ROADMAP).
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
      occurrencesFor: defaultOccurrencesFor,
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
    const setupKey = normalizeSetupKey(rule.setupKey);
    if (!setupKey) return null;
    const full: SetupAlertRule = {
      ...rule,
      setupKey,
      id: newRuleId(now),
      createdAt: now,
      paused: false,
    };
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
      reason: `${BRAND.name} can reach this chat. Setup alerts will arrive here with their track record.`,
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
      let result: { current: CurrentSetup[]; sig: string };
      try {
        result = await this.deps.scanFor(interval, this.deps.watchlist());
      } catch {
        continue; // analysis service unavailable; try again next check
      }
      if (this.lastSig.get(interval) === result.sig) continue;
      this.lastSig.set(interval, result.sig);
      const open = [
        ...new Set(
          firings
            .filter((f) => f.interval === interval && f.outcome === "open")
            .map((f) => f.symbol),
        ),
      ];
      const occBySymbol = new Map<string, SetupOccurrence[]>();
      for (const symbol of open) {
        try {
          occBySymbol.set(symbol, await this.deps.occurrencesFor(symbol, interval));
        } catch {
          // keep the outcome as it was; retried at the next check
        }
      }
      firings = firings.map((f) =>
        f.interval === interval && f.outcome === "open" && occBySymbol.has(f.symbol)
          ? { ...f, outcome: resolveOutcome(f, occBySymbol.get(f.symbol)!) }
          : f,
      );
      const known = new Set([...firings, ...fresh].map((f) => f.id));
      fresh.push(
        ...matchFirings(
          this.snap.rules,
          result.current,
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
