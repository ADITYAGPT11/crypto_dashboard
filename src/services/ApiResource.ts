/**
 * Cached API resources with subscriptions: one fetch per key however many
 * components show it, refreshed on a per-resource schedule while anyone listens
 * (e.g. the chart's analysis right after each candle closes).
 */

export interface ResourceState<T> {
  data: T | null;
  error: string | null;
  /** True while a request is in flight (stale data stays visible meanwhile). */
  loading: boolean;
  updatedAt: number | null;
}

const EMPTY: ResourceState<never> = { data: null, error: null, loading: false, updatedAt: null };
const RETRY_AFTER_ERROR_MS = 30_000;

interface Entry<T> {
  state: ResourceState<T>;
  listeners: Set<() => void>;
  timer: ReturnType<typeof setTimeout> | null;
  inflight: Promise<void> | null;
}

export interface ResourceOptions<T> {
  fetch: (key: string) => Promise<T>;
  /** Milliseconds until the next refresh while subscribed, or null for never. */
  refreshIn?: (data: T, key: string, now: number) => number | null;
  now?: () => number;
}

export class ApiResource<T> {
  private entries = new Map<string, Entry<T>>();
  private now: () => number;

  constructor(private opts: ResourceOptions<T>) {
    this.now = opts.now ?? Date.now;
  }

  get(key: string): ResourceState<T> {
    return this.entries.get(key)?.state ?? EMPTY;
  }

  subscribe(key: string, listener: () => void): () => void {
    const e = this.entry(key);
    e.listeners.add(listener);
    if (!e.state.updatedAt && !e.inflight) void this.load(key);
    else if (!e.timer && !e.inflight) this.schedule(key);
    return () => {
      e.listeners.delete(listener);
      if (e.listeners.size === 0 && e.timer) {
        clearTimeout(e.timer);
        e.timer = null;
      }
    };
  }

  /** Fetch now (shared with a request already in flight). */
  refresh(key: string): Promise<void> {
    return this.load(key);
  }

  private entry(key: string): Entry<T> {
    let e = this.entries.get(key);
    if (!e) {
      e = { state: EMPTY, listeners: new Set(), timer: null, inflight: null };
      this.entries.set(key, e);
    }
    return e;
  }

  private load(key: string): Promise<void> {
    const e = this.entry(key);
    if (e.inflight) return e.inflight;
    if (e.timer) clearTimeout(e.timer);
    e.timer = null;
    this.set(e, { ...e.state, loading: true });
    e.inflight = this.opts
      .fetch(key)
      .then(
        (data) => this.set(e, { data, error: null, loading: false, updatedAt: this.now() }),
        (err: unknown) =>
          this.set(e, {
            ...e.state,
            error: err instanceof Error ? err.message : String(err),
            loading: false,
            updatedAt: e.state.updatedAt ?? this.now(),
          }),
      )
      .finally(() => {
        e.inflight = null;
        this.schedule(key);
      });
    return e.inflight;
  }

  private schedule(key: string) {
    const e = this.entry(key);
    if (e.listeners.size === 0 || e.timer) return;
    const { data, error } = e.state;
    const wait =
      error || data === null
        ? RETRY_AFTER_ERROR_MS
        : (this.opts.refreshIn?.(data, key, this.now()) ?? null);
    if (wait === null) return;
    e.timer = setTimeout(
      () => {
        e.timer = null;
        void this.load(key);
      },
      Math.max(1_000, wait),
    );
  }

  private set(e: Entry<T>, state: ResourceState<T>) {
    e.state = state;
    for (const l of e.listeners) l();
  }
}
