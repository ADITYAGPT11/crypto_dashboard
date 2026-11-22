/**
 * Keeps chart labels from overlapping: each label tries a few vertical nudges and takes the
 * first spot that is free and on screen; when none is, it is left out. Labels placed first win,
 * so the selected pattern's labels are placed before the faint ones.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Vertical nudges tried in order, in label heights (0 = where it wants to be). */
export const NUDGES = [0, -1, 1, -2, 2] as const;

export function overlaps(a: Rect, b: Rect, gap = 2): boolean {
  return (
    a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap
  );
}

/**
 * Vertical offset (px) that puts `r` clear of every `placed` rect and inside `bounds`
 * (height only; labels may run off the sides), or null when no nudge fits.
 * `away` flips the nudge order so the first try moves away from the pattern (−1 = up).
 */
export function freeOffset(
  r: Rect,
  placed: readonly Rect[],
  bounds: { top: number; bottom: number },
  away: 1 | -1 = -1,
): number | null {
  for (const n of NUDGES) {
    const dy = n === 0 ? 0 : n * (r.h + 2) * -away;
    const c = { ...r, y: r.y + dy };
    if (c.y < bounds.top || c.y + c.h > bounds.bottom) continue;
    if (!placed.some((p) => overlaps(c, p))) return dy;
  }
  return null;
}
