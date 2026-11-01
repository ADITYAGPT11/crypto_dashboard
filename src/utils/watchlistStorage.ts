/**
 * Watchlist persistence utilities.
 *
 * Keeps the tracked-symbol list alive across page reloads by storing a validated,
 * canonical symbol list in localStorage. Parsing is kept pure (no side effects)
 * so it stays unit-testable; only load()/save() touch storage.
 */
export const WATCHLIST_STORAGE_KEY = "watchlist:symbols";

export const DEFAULT_WATCHLIST: readonly string[] = ["BTC-USDT", "ETH-USDT"];

/** Guard against unbounded localStorage growth if a client tool ever spams the list. */
const MAX_WATCHLIST_ENTRIES = 100;

/** Canonical app format is BASE-QUOTE (e.g. BTC-USDT), uppercase alphanumeric parts. */
const SYMBOL_FORMAT = /^[A-Z0-9]+-[A-Z0-9]+$/;

/**
 * Validate/coerce an unknown parsed value into a clean symbol list.
 * Returns only well-formed canonical symbols, deduplicated, capped, in first-seen order.
 */
export function parseWatchlist(value: unknown): string[] {
  const result: string[] = [];
  if (!Array.isArray(value)) {
    return result;
  }
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    if (entry.length === 0 || entry.length > 20) continue;
    if (!SYMBOL_FORMAT.test(entry)) continue;
    if (result.includes(entry)) continue;
    result.push(entry);
    if (result.length >= MAX_WATCHLIST_ENTRIES) break;
  }
  return result;
}

export type WatchlistReadResult = { ok: true; symbols: string[] } | { ok: false };

/**
 * Parse the raw stored JSON value into a watchlist.
 * Exported for tests / manual inspection of stored values.
 */
export function readStoredWatchlist(raw: string | null | undefined): string[] {
  if (typeof raw !== "string") return [];
  try {
    return parseWatchlist(JSON.parse(raw) as unknown);
  } catch {
    return [];
  }
}

/**
 * Load the persisted watchlist. Always returns a usable, non-empty list:
 * falls back to the default watchlist when storage is missing/empty/corrupt.
 */
export function loadWatchlist(
  storage: Pick<Storage, "getItem"> | undefined = typeof localStorage === "undefined"
    ? undefined
    : localStorage,
): string[] {
  const stored = readStoredWatchlist(storage?.getItem(WATCHLIST_STORAGE_KEY));
  if (stored.length > 0) {
    return stored;
  }
  return [...DEFAULT_WATCHLIST];
}

/**
 * Save the watchlist. Persistence failure (quota, private mode, disabled storage)
 * must never break the dashboard, but is logged so the silent data loss is visible in devtools.
 */
export function saveWatchlist(
  symbols: string[],
  storage: Pick<Storage, "setItem"> | undefined = typeof localStorage === "undefined"
    ? undefined
    : localStorage,
): void {
  if (!storage) return;
  try {
    const clean = parseWatchlist(symbols);
    storage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(clean));
  } catch (error) {
    console.error("Failed to persist watchlist:", error);
  }
}
