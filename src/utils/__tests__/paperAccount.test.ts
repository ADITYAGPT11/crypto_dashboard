import { describe, expect, it } from "vite-plus/test";
import type { PaperTradeOut } from "../../api/schema";
import { parsePaperSettings, simulatePaper, usd } from "../paperAccount";

const H = 3_600_000;
const trade = (
  fill: number,
  exit: number,
  rNet: number,
  rGross = rNet + 0.1,
  entry = 100,
  stop = 98,
): PaperTradeOut => ({
  symbol: "BTC-USDT",
  pattern: "hammer",
  direction: "long",
  location: "zone",
  time: fill - H,
  entryPrice: entry,
  stop,
  exitPrice: null,
  reason: "trail",
  rNet,
  rGross,
  fillTime: fill,
  exitTime: exit,
});

describe("paper account", () => {
  it("turns R into dollars: 1R is the money risked", () => {
    const r = simulatePaper([trade(0, H, 2), trade(2 * H, 3 * H, -1)], {
      start: 10_000,
      riskPct: 1,
      compound: false,
    });
    // +2R on $100 risk, then −1R on $100 risk.
    expect(r.fills.map((f) => f.pnl)).toEqual([200, -100]);
    expect(r.balance).toBe(10_100);
    expect(r.returnPct).toBeCloseTo(1);
    expect(r.wins).toBe(1);
    expect(r.losses).toBe(1);
    expect(r.fees).toBeCloseTo(20); // 0.1R × $100, twice
    expect(r.fills[0].qty).toBeCloseTo(50); // $100 / $2 per coin
    expect(r.fills[0].notional).toBeCloseTo(5_000);
    expect(r.maxDrawdown).toBe(100);
    expect(r.maxDrawdownPct).toBeCloseTo((100 / 10_200) * 100);
  });

  it("compounds from the balance when each trade opens", () => {
    const r = simulatePaper([trade(0, H, 1), trade(2 * H, 3 * H, 1)], {
      start: 10_000,
      riskPct: 1,
      compound: true,
    });
    expect(r.fills[1].riskUsd).toBeCloseTo(101); // 1% of $10 100
    expect(r.balance).toBeCloseTo(10_201);
  });

  it("sizes overlapping trades from closed results only and counts them", () => {
    // Both open before either closes: both risk 1% of $10 000.
    const r = simulatePaper([trade(0, 3 * H, 1), trade(H, 2 * H, -1)], {
      start: 10_000,
      riskPct: 1,
      compound: true,
    });
    expect(r.fills.map((f) => f.riskUsd)).toEqual([100, 100]);
    expect(r.maxOpen).toBe(2);
    expect(r.fills.map((f) => f.trade.fillTime)).toEqual([H, 0]); // closing order
  });

  it("sizes a trade filled and stopped in the same candle", () => {
    const r = simulatePaper([trade(H, H, -1.1)], { start: 10_000, riskPct: 1, compound: true });
    expect(r.fills).toHaveLength(1);
    expect(r.fills[0].riskUsd).toBe(100);
    expect(r.fills[0].pnl).toBeCloseTo(-110);
    expect(r.balance).toBeCloseTo(9_890);
    expect(r.maxOpen).toBe(1);
  });

  it("skips trades without times and validates saved settings", () => {
    const r = simulatePaper([{ ...trade(0, H, 1), exitTime: null }], {
      start: 1_000,
      riskPct: 1,
      compound: true,
    });
    expect(r.fills).toHaveLength(0);
    expect(r.balance).toBe(1_000);
    expect(parsePaperSettings({ start: 5_000, riskPct: 2, compound: false })).toEqual({
      start: 5_000,
      riskPct: 2,
      compound: false,
    });
    expect(parsePaperSettings({ start: -1, riskPct: 7 })).toEqual({
      start: 10_000,
      riskPct: 1,
      compound: true,
    });
  });

  it("formats dollars", () => {
    expect(usd(10_234.4)).toBe("$10,234");
    expect(usd(-12.5)).toBe("−$12.50");
    expect(usd(35, true)).toBe("+$35.00");
  });
});
