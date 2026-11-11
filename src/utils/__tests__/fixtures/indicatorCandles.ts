import type { Candle } from "../../../types/marketData";

/**
 * Deterministic candles for indicator golden tests: a seeded random walk with
 * trends, reversals and uneven ranges and volumes, so PSAR flips and ATR moves.
 * Changing this changes the golden file: regenerate it with the old library.
 */
export function goldenCandles(n = 200): Candle[] {
  let seed = 42;
  const rand = () => {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    return seed / 2_147_483_648;
  };
  const out: Candle[] = [];
  let close = 100;
  for (let i = 0; i < n; i++) {
    const open = close;
    const drift = 0.6 * Math.sin(i / 15);
    close = Math.max(1, open + drift + (rand() - 0.5) * 4);
    const high = Math.max(open, close) + rand() * 2;
    const low = Math.min(open, close) - rand() * 2;
    out.push({ openTime: i * 3_600_000, open, high, low, close, volume: 50 + rand() * 500 });
  }
  return out;
}
