import { describe, expect, it } from "vite-plus/test";
import {
  computePosition,
  DEFAULT_RISK_PREFS,
  expectedValue,
  parseRiskPrefs,
  type Position,
  type RiskInput,
} from "../riskCalc";

const BASE: RiskInput = {
  account: 10_000,
  riskPct: 1,
  entry: 100,
  stop: 95,
  target: 110,
  feePct: 0,
};

function position(input: Partial<RiskInput> = {}): Position {
  const r = computePosition({ ...BASE, ...input });
  if (!r.ok) throw new Error(r.error);
  return r.position;
}

describe("computePosition", () => {
  it("sizes a long so a stop-out loses exactly the risk amount (no fees)", () => {
    const p = position();
    expect(p.direction).toBe("long");
    expect(p.riskAmount).toBe(100);
    expect(p.quantity).toBe(20);
    expect(p.notional).toBe(2000);
    expect(p.leverage).toBe(0.2);
    expect(p.stopPct).toBe(5);
    expect(p.rewardRisk).toBe(2);
    expect(p.lossAtStop).toBe(100);
    expect(p.gainAtTarget).toBe(200);
    expect(p.breakEven).toBeCloseTo(1 / 3, 10);
  });

  it("adds fees on both sides to the loss and takes them from the gain", () => {
    const p = position({ feePct: 0.1 });
    // 20 units: entry 2000 + stop 1900 notional, 0.1% each side
    expect(p.feesAtStop).toBeCloseTo(3.9, 10);
    expect(p.feesAtTarget).toBeCloseTo(4.2, 10);
    expect(p.lossAtStop).toBeCloseTo(103.9, 10);
    expect(p.gainAtTarget).toBeCloseTo(195.8, 10);
    expect(p.breakEven).toBeGreaterThan(1 / 3);
  });

  it("treats a stop above entry as a short", () => {
    const p = position({ stop: 105, target: 90 });
    expect(p.direction).toBe("short");
    expect(p.quantity).toBe(20);
    expect(p.gainAtTarget).toBe(200);
  });

  it("rejects a target on the wrong side of entry", () => {
    expect(computePosition({ ...BASE, target: 99 })).toEqual({
      ok: false,
      error: "For a long (stop below entry), the target must be above entry.",
    });
    expect(computePosition({ ...BASE, stop: 105, target: 101 }).ok).toBe(false);
  });

  it("rejects missing or impossible inputs", () => {
    expect(computePosition({ ...BASE, entry: Number.NaN }).ok).toBe(false);
    expect(computePosition({ ...BASE, stop: 100 }).ok).toBe(false);
    expect(computePosition({ ...BASE, riskPct: 0 }).ok).toBe(false);
    expect(computePosition({ ...BASE, account: -5 }).ok).toBe(false);
    expect(computePosition({ ...BASE, feePct: -1 }).ok).toBe(false);
  });
});

describe("expectedValue", () => {
  it("is zero at the break-even win rate and scales with the win rate", () => {
    const p = position({ feePct: 0.05 });
    expect(expectedValue(p, p.breakEven)).toBeCloseTo(0, 8);
    expect(expectedValue(p, 0.5)).toBeCloseTo(0.5 * p.gainAtTarget - 0.5 * p.lossAtStop, 10);
    expect(expectedValue(p, 0)).toBeCloseTo(-p.lossAtStop, 10);
  });
});

describe("parseRiskPrefs", () => {
  it("keeps valid values and replaces bad ones with defaults", () => {
    expect(parseRiskPrefs({ account: 2500, riskPct: 0.5, feePct: 0 })).toEqual({
      account: 2500,
      riskPct: 0.5,
      feePct: 0,
    });
    expect(parseRiskPrefs({ account: -1, riskPct: 300, feePct: "x" })).toEqual(DEFAULT_RISK_PREFS);
    expect(parseRiskPrefs(null)).toEqual(DEFAULT_RISK_PREFS);
  });
});
