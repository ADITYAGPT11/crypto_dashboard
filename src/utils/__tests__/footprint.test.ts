import { describe, expect, it } from "vite-plus/test";
import type { Candle, TradeEvent } from "../../types/marketData";
import {
  autoStep,
  barOpen,
  compactVolume,
  FootprintBook,
  imbalanceAt,
  niceStep,
  rowOf,
} from "../footprint";

const H = 3_600_000;
const trade = (t: number, price: number, qty: number, sold = false): TradeEvent => ({
  exchange: "BINANCE",
  symbol: "BTC-USDT",
  type: "FUT",
  price,
  quantity: qty,
  buyerMaker: sold,
  timeStamp: t,
});

describe("footprint", () => {
  it("picks nice steps and about a dozen rows per candle", () => {
    expect(niceStep(7.3)).toBe(5);
    expect(niceStep(0.0021)).toBeCloseTo(0.002, 12);
    expect(niceStep(34)).toBe(25);
    expect(niceStep(0)).toBe(1);
    const cs: Candle[] = Array.from({ length: 60 }, (_, i) => ({
      openTime: i * H,
      open: 100,
      high: 112,
      low: 100,
      close: 105,
      volume: 1,
    }));
    expect(autoStep(cs)).toBe(1); // range 12 / 12 rows
  });

  it("bins prices into rows without float drift", () => {
    expect(rowOf(0.3, 0.1)).toBe(3);
    expect(rowOf(65_432.5, 5)).toBe(13_086);
  });

  it("splits each bar's volume by aggressor side per row", () => {
    const book = new FootprintBook(H, 10);
    book.add(trade(1_000, 101, 2)); // bought at row 10
    book.add(trade(2_000, 105, 1, true)); // sold at row 10
    book.add(trade(3_000, 115, 4)); // bought at row 11
    book.add(trade(H + 5, 99, 3, true)); // next bar, sold at row 9
    const [a, b] = book.snapshot();
    expect(a.openTime).toBe(0);
    expect(a.rows.get(10)).toEqual({ bid: 1, ask: 2 });
    expect(a.rows.get(11)).toEqual({ bid: 0, ask: 4 });
    expect(a.volume).toBe(7);
    expect(a.delta).toBe(5);
    expect(a.poc).toBe(11);
    expect(b.openTime).toBe(H);
    expect(b.delta).toBe(-3);
  });

  it("keeps a bounded number of bars and returns copies", () => {
    const book = new FootprintBook(H, 1, 2);
    for (let i = 0; i < 4; i++) book.add(trade(i * H, 100, 1));
    const snap = book.snapshot();
    expect(snap.map((b) => b.openTime)).toEqual([2 * H, 3 * H]);
    snap[0].rows.get(100)!.ask = 99;
    expect(book.snapshot()[0].rows.get(100)!.ask).toBe(1);
  });

  it("reads imbalance on the diagonal", () => {
    const book = new FootprintBook(H, 1);
    book.add(trade(0, 100, 1, true)); // row 100 bid 1
    book.add(trade(0, 101, 3)); // row 101 ask 3 = 3 × bid one row lower
    book.add(trade(0, 102, 0.5)); // row 102 ask 0.5
    book.add(trade(0, 101, 2, true)); // row 101 bid 2 ≥ 3 × ask(102) = 1.5
    const [bar] = book.snapshot();
    expect(imbalanceAt(bar, 101)).toBe("buy");
    expect(imbalanceAt(bar, 999)).toBeNull();
    // Only sellers' side: row 101 bid 2 vs ask(102) 0.5 ⇒ sell, once the buy check fails.
    const book2 = new FootprintBook(H, 1);
    book2.add(trade(0, 101, 2, true));
    book2.add(trade(0, 101, 1));
    book2.add(trade(0, 100, 1, true));
    book2.add(trade(0, 102, 0.5));
    expect(imbalanceAt(book2.snapshot()[0], 101)).toBe("sell");
    // A lone small print is not an imbalance once a floor is set.
    expect(imbalanceAt(book2.snapshot()[0], 102, 3, 1)).toBeNull();
  });

  it("opens weekly bars on Monday", () => {
    const W = 7 * 86_400_000;
    const monday = 4 * 86_400_000; // 1970-01-05
    expect(barOpen(monday + 3 * 86_400_000, W)).toBe(monday);
    expect(barOpen(5 * H + 10, H)).toBe(5 * H);
  });

  it("formats volumes compactly", () => {
    expect(compactVolume(0.4213)).toBe("0.42");
    expect(compactVolume(12.34)).toBe("12.3");
    expect(compactVolume(1234)).toBe("1.2K");
    expect(compactVolume(-25_000)).toBe("-25K");
    expect(compactVolume(3_400_000)).toBe("3.4M");
  });
});
