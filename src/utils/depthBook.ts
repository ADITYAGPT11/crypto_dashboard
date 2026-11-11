/**
 * A full-depth local order book kept in sync from exchange diff streams.
 *
 * - Binance USDⓈ-M (documented procedure): buffer `depthUpdate` events, fetch a REST
 *   snapshot, drop events with `u < lastUpdateId`, the first applied event must
 *   straddle the snapshot (`U <= lastUpdateId <= u`), and every later event's `pu`
 *   must equal the previous `u`; otherwise the book is rebuilt.
 * - OKX `books` channel: a snapshot, then updates whose `prevSeqId` must equal the
 *   last `seqId`; otherwise resubscribe.
 *
 * Sizes are stored in BASE units (OKX contracts are multiplied by the contract value).
 */

export type Side = "bid" | "ask";
export type Level = [price: number, size: number];

export class LocalBook {
  readonly bids = new Map<number, number>();
  readonly asks = new Map<number, number>();

  clear() {
    this.bids.clear();
    this.asks.clear();
  }

  apply(side: Side, levels: readonly Level[]) {
    const m = side === "bid" ? this.bids : this.asks;
    for (const [p, q] of levels) {
      if (q <= 0) m.delete(p);
      else m.set(p, q);
    }
  }

  bestBid(): number | null {
    let best: number | null = null;
    for (const p of this.bids.keys()) if (best === null || p > best) best = p;
    return best;
  }

  bestAsk(): number | null {
    let best: number | null = null;
    for (const p of this.asks.keys()) if (best === null || p < best) best = p;
    return best;
  }

  mid(): number | null {
    const b = this.bestBid();
    const a = this.bestAsk();
    return b !== null && a !== null ? (a + b) / 2 : (b ?? a);
  }

  /** Crossed books mean a missed update: the caller should resync. */
  crossed(): boolean {
    const b = this.bestBid();
    const a = this.bestAsk();
    return b !== null && a !== null && b >= a;
  }
}

export function parseLevels(raw: unknown, multiplier = 1): Level[] {
  if (!Array.isArray(raw)) return [];
  const out: Level[] = [];
  for (const r of raw) {
    if (!Array.isArray(r) || r.length < 2) continue;
    const p = Number(r[0]);
    const q = Number(r[1]) * multiplier;
    if (Number.isFinite(p) && Number.isFinite(q) && p > 0 && q >= 0) out.push([p, q]);
  }
  return out;
}

export interface BinanceDiff {
  U: number;
  u: number;
  pu: number;
  b: Level[];
  a: Level[];
}

export function parseBinanceDiff(msg: unknown): BinanceDiff | null {
  const m = (msg as { data?: unknown })?.data ?? msg;
  const v = m as Record<string, unknown> | null;
  if (!v || v.e !== "depthUpdate") return null;
  const U = Number(v.U);
  const u = Number(v.u);
  const pu = Number(v.pu);
  if (![U, u, pu].every(Number.isFinite)) return null;
  return { U, u, pu, b: parseLevels(v.b), a: parseLevels(v.a) };
}

export type SyncResult = "applied" | "skipped" | "buffered" | "resync";

/** Binance's snapshot + diff synchronisation. Feed every event; call `snapshot` once fetched. */
export class BinanceBookSync {
  readonly book = new LocalBook();
  private buffer: BinanceDiff[] = [];
  private lastU: number | null = null;
  private snapshotId: number | null = null;

  get ready(): boolean {
    return this.lastU !== null;
  }

  reset() {
    this.book.clear();
    this.buffer = [];
    this.lastU = null;
    this.snapshotId = null;
  }

  snapshot(lastUpdateId: number, bids: Level[], asks: Level[]): SyncResult {
    this.book.clear();
    this.book.apply("bid", bids);
    this.book.apply("ask", asks);
    this.snapshotId = lastUpdateId;
    this.lastU = null;
    const pending = this.buffer;
    this.buffer = [];
    let result: SyncResult = "buffered";
    for (const e of pending) {
      result = this.diff(e);
      if (result === "resync") return result;
    }
    return result;
  }

  diff(e: BinanceDiff): SyncResult {
    if (this.snapshotId === null) {
      this.buffer.push(e);
      if (this.buffer.length > 2000) this.buffer.shift();
      return "buffered";
    }
    if (this.lastU === null) {
      if (e.u < this.snapshotId) return "skipped";
      if (e.U > this.snapshotId) return "resync"; // missed events between snapshot and stream
    } else if (e.pu !== this.lastU) {
      return "resync";
    }
    this.book.apply("bid", e.b);
    this.book.apply("ask", e.a);
    this.lastU = e.u;
    return this.book.crossed() ? "resync" : "applied";
  }
}

export interface OkxBookMsg {
  action: "snapshot" | "update";
  seqId: number;
  prevSeqId: number;
  bids: Level[];
  asks: Level[];
}

export function parseOkxBook(msg: unknown, ctVal: number): OkxBookMsg | null {
  const v = msg as { action?: unknown; data?: unknown[] } | null;
  if (!v || (v.action !== "snapshot" && v.action !== "update") || !Array.isArray(v.data))
    return null;
  const d = v.data[0] as Record<string, unknown> | undefined;
  if (!d) return null;
  const seqId = Number(d.seqId);
  const prevSeqId = Number(d.prevSeqId ?? -1);
  if (!Number.isFinite(seqId)) return null;
  return {
    action: v.action,
    seqId,
    prevSeqId,
    bids: parseLevels(d.bids, ctVal),
    asks: parseLevels(d.asks, ctVal),
  };
}

/** OKX `books`: snapshot then sequenced updates. */
export class OkxBookSync {
  readonly book = new LocalBook();
  private seq: number | null = null;

  get ready(): boolean {
    return this.seq !== null;
  }

  reset() {
    this.book.clear();
    this.seq = null;
  }

  handle(m: OkxBookMsg): SyncResult {
    if (m.action === "snapshot") {
      this.book.clear();
      this.book.apply("bid", m.bids);
      this.book.apply("ask", m.asks);
      this.seq = m.seqId;
      return "applied";
    }
    if (this.seq === null) return "skipped";
    if (m.prevSeqId !== this.seq) return "resync";
    this.book.apply("bid", m.bids);
    this.book.apply("ask", m.asks);
    this.seq = m.seqId;
    return this.book.crossed() ? "resync" : "applied";
  }
}
