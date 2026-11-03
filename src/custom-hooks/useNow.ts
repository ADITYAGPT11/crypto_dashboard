import { useEffect, useState } from "react";

/** Current time, refreshed every `everyMs` (for "updated 3s ago" labels and clocks). */
export function useNow(everyMs = 1_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}
