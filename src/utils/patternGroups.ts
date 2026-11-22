/**
 * The chart page's pattern rows: every detection on the chart grouped by pattern and
 * direction (one row each), newest first, with the timeframes it was found on.
 */
import type { CandleInterval } from "../types/marketData";
import type { Direction, PatternId } from "../types/analysis";

/** The fields of a detection the grouping needs. */
export interface Detection {
  pattern: PatternId;
  direction: Direction;
  tf: CandleInterval;
  /** Close time of the confirmation candle, ms. */
  closeTime: number;
}

export interface PatternGroup<T extends Detection> {
  /** `pattern|direction`. */
  id: string;
  pattern: PatternId;
  direction: Direction;
  /** The newest detection of this pattern and direction on any timeframe. */
  latest: T;
  /** Timeframes it was found on, in the order given. */
  tfs: CandleInterval[];
  count: number;
}

export const groupId = (d: Pick<Detection, "pattern" | "direction">) =>
  `${d.pattern}|${d.direction}`;

/** Group detections by pattern and direction; groups sorted by their newest detection. */
export function groupDetections<T extends Detection>(
  found: readonly T[],
  tfOrder: readonly CandleInterval[],
): PatternGroup<T>[] {
  const groups = new Map<string, PatternGroup<T>>();
  for (const f of found) {
    const id = groupId(f);
    const g = groups.get(id);
    if (!g) {
      groups.set(id, {
        id,
        pattern: f.pattern,
        direction: f.direction,
        latest: f,
        tfs: [f.tf],
        count: 1,
      });
      continue;
    }
    g.count += 1;
    if (!g.tfs.includes(f.tf)) g.tfs.push(f.tf);
    if (f.closeTime > g.latest.closeTime) g.latest = f;
  }
  const rank = (tf: CandleInterval) => {
    const i = tfOrder.indexOf(tf);
    return i < 0 ? tfOrder.length : i;
  };
  return [...groups.values()]
    .map((g) => ({ ...g, tfs: [...g.tfs].sort((a, b) => rank(a) - rank(b)) }))
    .sort((a, b) => b.latest.closeTime - a.latest.closeTime || a.id.localeCompare(b.id));
}
