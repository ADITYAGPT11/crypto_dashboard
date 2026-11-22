/**
 * The chart page's pattern list: the newest detections on the picked timeframes that meet at
 * least `MIN_CHECKS` of the setup checklist, one row each, at most `LIST_SIZE` of them.
 */

/** Fewest checklist checks a detection needs to be listed or drawn (of 6). */
export const MIN_CHECKS = 3;
/** Rows in the list. */
export const LIST_SIZE = 10;

/** The fields of a detection the list needs. */
export interface Listed {
  /** Close time of the confirmation candle, ms. */
  closeTime: number;
  occ: { score: number };
}

/** Detections meeting `min` checks, newest first, at most `size`. */
export function latestPatterns<T extends Listed>(
  found: readonly T[],
  min = MIN_CHECKS,
  size = LIST_SIZE,
): T[] {
  return found
    .filter((f) => f.occ.score >= min)
    .sort((a, b) => b.closeTime - a.closeTime)
    .slice(0, size);
}

/**
 * Chart timeframe after clicking a pattern: the pattern's own when it is lower than the chart's
 * (a 15m pattern is a sliver on a 4h chart), else the chart's unchanged.
 */
export function viewTfFor<T extends string>(patternTf: T, viewTf: T, ms: Record<T, number>): T {
  return ms[patternTf] < ms[viewTf] ? patternTf : viewTf;
}
