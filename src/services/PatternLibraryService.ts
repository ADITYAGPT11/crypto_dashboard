import type { CandleInterval } from "../types/marketData";
import type { LibraryKind, LibraryPatterns, LibraryStatsResponse } from "../types/patternLibrary";
import { LIBRARY_BASE } from "../utils/patternLibrary";
import { nextClose } from "./HistoryService";

/**
 * Patterns from the Python backend (ta_patterns detectors) and how each performed before.
 *
 * One entry per symbol × timeframe × kind: fetched once, kept until a newer candle closes,
 * then fetched again. Components read it through `usePatternLibrary`.
 */

export type LibraryStatus = "loading" | "ready" | "offline" | "error";

export interface LibraryEntry {
  status: LibraryStatus;
  patterns: LibraryPatterns | null;
  stats: LibraryStatsResponse | null;
  error: string | null;
  fetchedAt: number;
}

type Fetcher = (url: string) => Promise<unknown>;

const TIMEOUT_MS = 60_000; // first pooled stats scan 11 coins (~10 s)

/** Thrown when the backend can't be reached at all (not running, proxy missing). */
export class BackendOffline extends Error {}

const defaultFetcher: Fetcher = async (url) => {
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    throw new BackendOffline(err instanceof Error ? err.message : String(err));
  }
  // The Vite proxy answers 502/504 when nothing listens on :8000; HTML means no proxy at all.
  const type = res.headers.get("content-type") ?? "";
  if (!type.includes("application/json")) {
    throw new BackendOffline(`HTTP ${res.status}`);
  }
  const body: unknown = await res.json();
  if (!res.ok) {
    const detail = body && typeof body === "object" && "detail" in body ? String(body.detail) : "";
    throw new Error(detail || `HTTP ${res.status}`);
  }
  return body;
};

function isPatterns(x: unknown): x is LibraryPatterns {
  return (
    !!x &&
    typeof x === "object" &&
    Array.isArray((x as LibraryPatterns).events) &&
    Array.isArray((x as LibraryPatterns).current)
  );
}

function isStats(x: unknown): x is LibraryStatsResponse {
  return !!x && typeof x === "object" && Array.isArray((x as LibraryStatsResponse).stats);
}

export class PatternLibraryService {
  private static instance: PatternLibraryService | null = null;
  private entries = new Map<string, LibraryEntry>();
  private inflight = new Map<string, Promise<void>>();
  private listeners = new Set<() => void>();

  constructor(
    private fetcher: Fetcher = defaultFetcher,
    private now: () => number = Date.now,
  ) {}

  static getInstance(): PatternLibraryService {
    if (!PatternLibraryService.instance)
      PatternLibraryService.instance = new PatternLibraryService();
    return PatternLibraryService.instance;
  }

  static resetInstance() {
    PatternLibraryService.instance = null;
  }

  static key(symbol: string, interval: CandleInterval, kind: LibraryKind): string {
    return `${symbol}|${interval}|${kind}`;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get(symbol: string, interval: CandleInterval, kind: LibraryKind): LibraryEntry | null {
    return this.entries.get(PatternLibraryService.key(symbol, interval, kind)) ?? null;
  }

  /**
   * Fetch unless a fresh entry exists or a fetch is running. `force` refetches (retry).
   * Never rejects: failures land in the entry's status.
   */
  load(symbol: string, interval: CandleInterval, kind: LibraryKind, force = false): Promise<void> {
    const key = PatternLibraryService.key(symbol, interval, kind);
    const running = this.inflight.get(key);
    if (running) return running;
    const cur = this.entries.get(key);
    const fresh =
      cur?.status === "ready" && nextClose(cur.fetchedAt, interval) > this.now() && !force;
    if (fresh) return Promise.resolve();

    this.set(key, {
      status: "loading",
      patterns: cur?.patterns ?? null,
      stats: cur?.stats ?? null,
      error: null,
      fetchedAt: cur?.fetchedAt ?? 0,
    });
    const base = `${LIBRARY_BASE}/patterns/${encodeURIComponent(symbol)}/${interval}`;
    const q = `kinds=${kind}`;
    const p = Promise.all([this.fetcher(`${base}?${q}`), this.fetcher(`${base}/stats?${q}`)])
      .then(([patterns, stats]) => {
        if (!isPatterns(patterns) || !isStats(stats)) throw new Error("unexpected response");
        this.set(key, { status: "ready", patterns, stats, error: null, fetchedAt: this.now() });
      })
      .catch((err: unknown) => {
        this.set(key, {
          status: err instanceof BackendOffline ? "offline" : "error",
          patterns: null,
          stats: null,
          error: err instanceof Error ? err.message : String(err),
          fetchedAt: 0,
        });
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  private set(key: string, entry: LibraryEntry) {
    this.entries.set(key, entry);
    for (const l of this.listeners) l();
  }
}
