import { useEffect, useState } from "react";

export interface DataFreshness {
  hasData: boolean;
  /** true when data exists and was refreshed within `staleAfterMs`. */
  fresh: boolean;
  /** ms since the last update; null when no update has ever been received. */
  ageMs: number | null;
}

/**
 * Re-renders once per second while the component is mounted and classifies the
 * given update timestamp (epoch ms) as fresh or stale.
 *
 * `Date.now()` is only ever called inside the interval effect, never during
 * render (render must stay pure); the tick stores the timestamp in state.
 * A one-second tick per cell is cheap but only keeps mounted price cells alive.
 */
export function useDataFreshness(
  updatedAt: number | null,
  staleAfterMs: number = 6_000,
): DataFreshness {
  // Seed with the first known update time so the very first render has a sane
  // age; the effect immediately advances it to the real current time.
  const [now, setNow] = useState<number>(() => updatedAt ?? 0);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);

  if (updatedAt == null) {
    return { hasData: false, fresh: false, ageMs: null };
  }

  // `now` can briefly trail `updatedAt` right after a tick arrives; clamp to 0.
  const ageMs = Math.max(0, now - updatedAt);
  return { hasData: true, fresh: ageMs < staleAfterMs, ageMs };
}
