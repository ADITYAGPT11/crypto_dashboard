import { describe, expect, it } from "vite-plus/test";
import type { Candle } from "../../types/marketData";
import { computeInstance, INDICATORS, newInstance } from "../indicatorRegistry";
import { ALT_PARAMS } from "./fixtures/indicatorAltParams";
import { goldenCandles } from "./fixtures/indicatorCandles";
import golden from "./fixtures/indicators-golden-2.2.2.json";

/**
 * Value-equality against the outputs recorded with indicatorts 2.2.2 (12
 * significant digits), so a library upgrade cannot change a plotted value
 * unnoticed. NaN (warm-up) is stored as null.
 *
 * ATR and Parabolic SAR changed on purpose in 2.3.0 (upstream bug fixes, see
 * TOOLING.md → Reuse audit): they keep the 2.2.2 warm-up but are checked
 * against a reference instead of the old values.
 */
const outputs = golden.outputs as Record<string, Record<string, (number | null)[]>>;
const candles = goldenCandles(golden.candles);
const FIXED_UPSTREAM = new Set(["atr", "psar"]);

function run(key: string): Record<string, number[]> {
  const [id, alt] = key.split(":");
  const def = INDICATORS.find((d) => d.id === id)!;
  const inst = newInstance(def.id, key);
  if (alt) inst.params = ALT_PARAMS[def.id]!;
  return computeInstance(inst, candles);
}

function expectClose(label: string, i: number, got: number, want: number) {
  const tol = 1e-9 * Math.max(1, Math.abs(want));
  if (!(Math.abs(got - want) <= tol)) expect([label, i, got]).toEqual([label, i, want]);
}

/** Wilder ATR seeded with the SMA of the first `period` true ranges, as the backend does. */
function referenceAtr(c: Candle[], period: number): number[] {
  const tr = c.map((x, i) =>
    i === 0
      ? x.high - x.low
      : Math.max(
          x.high - x.low,
          Math.abs(x.high - c[i - 1].close),
          Math.abs(x.low - c[i - 1].close),
        ),
  );
  const out = c.map(() => Number.NaN);
  if (c.length <= period) return out;
  out[period] = tr.slice(1, period + 1).reduce((a, b) => a + b, 0) / period;
  for (let i = period + 1; i < c.length; i++) out[i] = (out[i - 1] * (period - 1) + tr[i]) / period;
  return out;
}

describe("indicator values match the recorded indicatorts 2.2.2 outputs", () => {
  it("covers every indicator and every alternative input set", () => {
    const keys = INDICATORS.flatMap((d) => (ALT_PARAMS[d.id] ? [d.id, `${d.id}:alt`] : [d.id]));
    expect(Object.keys(outputs).sort()).toEqual([...keys].sort());
  });

  for (const key of Object.keys(outputs)) {
    it(key, () => {
      const got = run(key);
      const fixed = FIXED_UPSTREAM.has(key.split(":")[0]);
      for (const [plot, want] of Object.entries(outputs[key])) {
        expect([key, plot, got[plot].length]).toEqual([key, plot, want.length]);
        got[plot].forEach((g, i) => {
          const w = want[i];
          // Warm-up (NaN) positions never move, even where values were fixed upstream.
          if (w === null || Number.isNaN(g)) {
            expect([key, plot, i, Number.isNaN(g)]).toEqual([key, plot, i, w === null]);
          } else if (!fixed) {
            expectClose(`${key}.${plot}`, i, g, w);
          }
        });
      }
    });
  }
});

describe("upstream fixes in indicatorts 2.3.0+", () => {
  it("ATR is Wilder's smoothing and equals the backend's ATR", () => {
    for (const length of [14, 7]) {
      const got = computeInstance({ ...newInstance("atr", "a"), params: { length } }, candles).atr;
      const want = referenceAtr(candles, length);
      want.forEach((w, i) =>
        Number.isNaN(w)
          ? expect(Number.isNaN(got[i])).toBe(true)
          : expectClose("atr", i, got[i], w),
      );
    }
  });

  it("Parabolic SAR sits below the candle in an uptrend and above it in a downtrend", () => {
    for (const params of [undefined, ALT_PARAMS.psar]) {
      const inst = newInstance("psar", "p");
      if (params) inst.params = params;
      const sar = computeInstance(inst, candles).sar;
      const inside = candles.filter((c, i) => i >= 2 && sar[i] > c.low && sar[i] < c.high);
      expect(inside).toEqual([]);
    }
  });
});
