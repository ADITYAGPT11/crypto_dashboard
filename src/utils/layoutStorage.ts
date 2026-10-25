/**
 * Dashboard layout persistence (Module 3 — widget customization).
 *
 * Persists an ordered list of panels with visibility flags so the trader's
 * arrangement survives page reloads. Mirrors the watchlistStorage pattern:
 * pure parsing (unit-testable), storage failure never breaks the dashboard.
 */
export const LAYOUT_STORAGE_KEY = "dashboard:panelLayout";

/** One widget's position + visibility in the dashboard. */
export interface PanelEntry {
  id: PanelId;
  visible: boolean;
}

/** Valid panel ids in this dashboard, in the default render order. */
export const DEFAULT_PANEL_LAYOUT = [
  "metrics",
  "connectionStatus",
  "chart",
  "priceTable",
  "arbitrage",
  "orderBook",
] as const;

export type PanelId = (typeof DEFAULT_PANEL_LAYOUT)[number];

const KNOWN_PANELS: readonly string[] = DEFAULT_PANEL_LAYOUT;

/**
 * Validate/coerce an unknown parsed value into a clean panel-entry list:
 * - accepts a plain id array (legacy/default form) or {id, visible} entries
 * - unknown & duplicate ids dropped, capped to the panel-set size
 * - default order preserved when no explicit order is stored
 */
export function parsePanelLayout(value: unknown): PanelEntry[] {
  if (!Array.isArray(value)) return [];
  const seenIds: PanelId[] = [];
  const visibleById = new Map<PanelId, boolean>();
  for (const entry of value) {
    let id: string | null = null;
    let visible: boolean | null = null;
    if (typeof entry === "string") {
      id = entry;
      visible = true;
    } else if (typeof entry === "object" && entry !== null && "id" in entry) {
      const e = entry as { id?: unknown; visible?: unknown };
      if (typeof e.id === "string") {
        id = e.id;
        visible = e.visible === false ? false : e.visible === true ? true : null;
      }
    }
    if (id === null || !KNOWN_PANELS.includes(id)) continue;
    const panelId = id as PanelId;
    if (!seenIds.includes(panelId)) seenIds.push(panelId);
    if (visible !== null) visibleById.set(panelId, visible);
    if (seenIds.length >= KNOWN_PANELS.length) break;
  }
  return seenIds.map((id) => ({ id, visible: visibleById.get(id) ?? true }));
}

/** Default layout: every panel visible, unmodified. */
export function defaultPanelEntries(): PanelEntry[] {
  return DEFAULT_PANEL_LAYOUT.map((id) => ({ id, visible: true }));
}

export type PanelReadResult = { ok: true; layout: PanelEntry[] } | { ok: false };

/**
 * Parse the raw stored JSON value into a panel layout.
 * Exported for tests / manual inspection of stored values.
 */
export function readStoredPanelLayout(raw: string | null | undefined): PanelEntry[] | null {
  if (typeof raw !== "string") return null;
  try {
    const parsed = parsePanelLayout(JSON.parse(raw) as unknown);
    // An empty/corrupt layout means "no customization yet", not a valid one.
    return parsed.length === 0 ? null : parsed;
  } catch {
    return null;
  }
}

/**
 * Load the persisted layout. Always returns a complete list: falls back to
 * the default layout when storage is missing/empty/corrupt, and appends any
 * panels the stored layout omitted (visible).
 */
export function loadPanelLayout(
  storage: Pick<Storage, "getItem"> | undefined = typeof localStorage === "undefined"
    ? undefined
    : localStorage,
): PanelEntry[] {
  const stored = readStoredPanelLayout(storage?.getItem(LAYOUT_STORAGE_KEY));
  if (stored) {
    const out = [...stored];
    for (const id of DEFAULT_PANEL_LAYOUT) {
      if (!out.some((e) => e.id === id)) out.push({ id, visible: true });
    }
    return out;
  }
  return defaultPanelEntries();
}

/**
 * Save the layout. Persistence failure (quota, private mode, disabled storage)
 * must never break the dashboard, but is logged so silent data loss is visible.
 */
export function savePanelLayout(
  entries: PanelEntry[],
  storage: Pick<Storage, "setItem"> | undefined = typeof localStorage === "undefined"
    ? undefined
    : localStorage,
): void {
  if (!storage) return;
  try {
    const raw = entries.map((e) => ({ id: e.id, visible: e.visible }));
    storage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(parsePanelLayout(raw)));
  } catch (error) {
    console.error("Failed to persist dashboard layout:", error);
  }
}
