import { describe, expect, it } from "vite-plus/test";
import {
  BinanceBookSync,
  OkxBookSync,
  parseBinanceDiff,
  parseOkxBook,
  type BinanceDiff,
} from "../depthBook";

const diff = (
  U: number,
  u: number,
  pu: number,
  b: [number, number][] = [],
  a: [number, number][] = [],
): BinanceDiff => ({
  U,
  u,
  pu,
  b,
  a,
});

describe("Binance snapshot + diff sync", () => {
  it("buffers until the snapshot, drops stale events and applies the straddling one", () => {
    const s = new BinanceBookSync();
    expect(s.diff(diff(90, 95, 89, [[99, 1]]))).toBe("buffered"); // older than the snapshot
    expect(s.diff(diff(96, 102, 95, [[100, 2]]))).toBe("buffered"); // straddles lastUpdateId=100
    s.snapshot(
      100,
      [
        [100, 1],
        [98, 5],
      ],
      [[101, 3]],
    );
    expect(s.ready).toBe(true);
    expect(s.book.bids.get(100)).toBe(2);
    expect(s.book.bids.has(99)).toBe(false); // the stale event was skipped
    expect(s.diff(diff(103, 104, 102, [[98, 0]], [[101.5, 1]]))).toBe("applied");
    expect(s.book.bids.has(98)).toBe(false); // size 0 removes the level
    expect(s.book.bestAsk()).toBe(101);
  });

  it("asks for a resync when an event is missed", () => {
    const s = new BinanceBookSync();
    s.snapshot(100, [[100, 1]], [[101, 1]]);
    expect(s.diff(diff(99, 101, 98))).toBe("applied");
    expect(s.diff(diff(105, 106, 104))).toBe("resync"); // pu 104 ≠ last u 101
  });

  it("asks for a resync when the stream started after the snapshot", () => {
    const s = new BinanceBookSync();
    s.snapshot(100, [[100, 1]], [[101, 1]]);
    expect(s.diff(diff(150, 160, 149))).toBe("resync");
  });

  it("treats a crossed book as a missed update", () => {
    const s = new BinanceBookSync();
    s.snapshot(100, [[100, 1]], [[101, 1]]);
    expect(s.diff(diff(99, 101, 98, [[102, 1]]))).toBe("resync");
  });

  it("parses combined-stream messages", () => {
    const d = parseBinanceDiff({
      stream: "btcusdt@depth@500ms",
      data: { e: "depthUpdate", U: 1, u: 2, pu: 0, b: [["100.5", "2"]], a: [["101", "0"]] },
    });
    expect(d).toEqual({ U: 1, u: 2, pu: 0, b: [[100.5, 2]], a: [[101, 0]] });
    expect(parseBinanceDiff({ e: "trade" })).toBeNull();
  });
});

describe("OKX books sync", () => {
  const msg = (
    action: "snapshot" | "update",
    seqId: number,
    prevSeqId: number,
    bids: string[][],
    asks: string[][],
  ) => parseOkxBook({ action, data: [{ seqId, prevSeqId, bids, asks }] }, 0.01)!;

  it("converts contracts to base units and follows the sequence", () => {
    const s = new OkxBookSync();
    expect(
      s.handle(msg("snapshot", 10, -1, [["100", "500", "0", "3"]], [["101", "200", "0", "1"]])),
    ).toBe("applied");
    expect(s.book.bids.get(100)).toBe(5); // 500 contracts × 0.01 BTC
    expect(s.handle(msg("update", 11, 10, [["100", "0", "0", "0"]], []))).toBe("applied");
    expect(s.book.bids.size).toBe(0);
    expect(s.handle(msg("update", 13, 12, [], []))).toBe("resync");
  });

  it("ignores updates before a snapshot", () => {
    const s = new OkxBookSync();
    expect(s.handle(msg("update", 2, 1, [], []))).toBe("skipped");
  });
});
