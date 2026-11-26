/**
 * The chart page's pattern list: the newest detections on the picked timeframes that meet at
 * least `MIN_CHECKS` of the setup checklist, at most `LIST_SIZE` rows. Detections confirmed on
 * the same candle, timeframe and side are one breakout, so they share one row: the one with the
 * most checks leads and the others are listed in `also`.
 */

/** Fewest checklist checks a detection needs to be listed or drawn (of 6). */
export const MIN_CHECKS = 3;
/** Rows in the list. */
export const LIST_SIZE = 10;

/** The fields of a detection the list needs. */
export interface Listed {
  /** Close time of the confirmation candle, ms. */
  closeTime: number;
  tf: string;
  direction: string;
  occ: { score: number };
}

/** A row: the leading detection plus the others confirmed on the same breakout. */
export type Grouped<T> = T & { also: T[] };

/** Detections meeting `min` checks, newest first, one row per breakout, at most `size` rows. */
export function latestPatterns<T extends Listed>(
  found: readonly T[],
  min = MIN_CHECKS,
  size = LIST_SIZE,
): Grouped<T>[] {
  const sorted = found
    .filter((f) => f.occ.score >= min)
    .sort((a, b) => b.closeTime - a.closeTime || b.occ.score - a.occ.score);
  const rows = new Map<string, Grouped<T>>();
  for (const f of sorted) {
    const key = `${f.closeTime}|${f.tf}|${f.direction}`;
    const row = rows.get(key);
    if (row) row.also.push(f);
    else rows.set(key, { ...f, also: [] });
  }
  return [...rows.values()].slice(0, size);
}

/**
 * Chart timeframe after clicking a pattern: the pattern's own when it is lower than the chart's
 * (a 15m pattern is a sliver on a 4h chart), else the chart's unchanged.
 */
export function viewTfFor<T extends string>(patternTf: T, viewTf: T, ms: Record<T, number>): T {
  return ms[patternTf] < ms[viewTf] ? patternTf : viewTf;
}
