/**
 * Unit tests for dashboard layout persistence (Module 3 widget customization).
 * Mirrors watchlistStorage.test.ts: in-memory Storage stub + corrupted-input
 * cases; load() must always return a usable complete layout.
 */
import { describe, expect, it } from "vite-plus/test";
import {
  DEFAULT_PANEL_LAYOUT,
  LAYOUT_STORAGE_KEY,
  loadPanelLayout,
  parsePanelLayout,
  readStoredPanelLayout,
  savePanelLayout,
  type PanelEntry,
} from "../layoutStorage";

describe("parsePanelLayout", () => {
  it("accepts a plain id array (default form, all visible)", () => {
    expect(parsePanelLayout(["metrics", "chart"])).to.deep.equal([
      { id: "metrics", visible: true },
      { id: "chart", visible: true },
    ]);
  });

  it("accepts {id, visible} entries", () => {
    expect(
      parsePanelLayout([
        { id: "metrics", visible: true },
        { id: "chart", visible: false },
      ]),
    ).to.deep.equal([
      { id: "metrics", visible: true },
      { id: "chart", visible: false },
    ]);
  });

  it("drops unknown ids and non-string entries", () => {
    const out = parsePanelLayout(["metrics", "evil-panel", 42, null, "chart"]);
    expect(out.map((e) => e.id)).to.deep.equal(["metrics", "chart"]);
  });

  it("deduplicates and preserves first-seen order", () => {
    const out = parsePanelLayout(["chart", "metrics", "chart"]);
    expect(out.map((e) => e.id)).to.deep.equal(["chart", "metrics"]);
  });

  it("treats {id} without a valid visible flag as visible", () => {
    expect(parsePanelLayout([{ id: "chart", visible: "yes" }])).to.deep.equal([
      { id: "chart", visible: true },
    ]);
  });

  it("returns an empty list for non-array input", () => {
    expect(parsePanelLayout("chart")).to.deep.equal([]);
    expect(parsePanelLayout({ id: "chart" })).to.deep.equal([]);
    expect(parsePanelLayout(null)).to.deep.equal([]);
  });
});

describe("readStoredPanelLayout", () => {
  it("parses valid JSON", () => {
    expect(readStoredPanelLayout(JSON.stringify(["chart", "metrics"]))).to.deep.equal([
      { id: "chart", visible: true },
      { id: "metrics", visible: true },
    ]);
  });

  it("returns null for corrupt JSON", () => {
    expect(readStoredPanelLayout("{not json")).to.equal(null);
  });

  it("returns null for an empty list (means 'no customization yet')", () => {
    expect(readStoredPanelLayout(JSON.stringify([]))).to.equal(null);
  });

  it("returns null for non-string input", () => {
    expect(readStoredPanelLayout(undefined)).to.equal(null);
    expect(readStoredPanelLayout(123 as unknown as string)).to.equal(null);
  });
});

describe("save/load roundtrip against an in-memory Storage stub", () => {
  function memoryStorage() {
    const data = new Map<string, string>();
    return {
      storage: {
        getItem: (key: string) => (data.has(key) ? data.get(key)! : null),
        setItem: (key: string, value: string) => {
          data.set(key, value);
        },
        removeItem: (key: string) => {
          data.delete(key);
        },
        clear: () => data.clear(),
      },
      peek: () => data.get(LAYOUT_STORAGE_KEY) ?? null,
    };
  }

  it("round-trips order and hidden panels across save/load", () => {
    const { storage } = memoryStorage();
    const layout: PanelEntry[] = [
      { id: "priceTable", visible: true },
      { id: "chart", visible: false },
    ];
    savePanelLayout(layout, storage);
    const loaded = loadPanelLayout(storage);
    expect(loaded).to.deep.equal([
      { id: "priceTable", visible: true },
      { id: "chart", visible: false },
      // Panels not present in the stored layout are appended visible.
      ...DEFAULT_PANEL_LAYOUT.filter((id) => id !== "priceTable" && id !== "chart").map((id) => ({
        id,
        visible: true,
      })),
    ]);
  });

  it("hidden panels stay hidden after a reload (no re-show)", () => {
    const { storage } = memoryStorage();
    savePanelLayout([{ id: "metrics", visible: false }], storage);
    const loaded = loadPanelLayout(storage);
    const metrics = loaded.find((e) => e.id === "metrics");
    expect(metrics?.visible).to.equal(false);
  });

  it("falls back to the default layout on corrupt storage", () => {
    const { storage } = memoryStorage();
    storage.setItem(LAYOUT_STORAGE_KEY, "{corrupt");
    expect(loadPanelLayout(storage)).to.deep.equal(
      DEFAULT_PANEL_LAYOUT.map((id) => ({ id, visible: true })),
    );
  });

  it("does not throw when storage rejects writes (quota/private mode)", () => {
    const throwing = {
      setItem: () => {
        const err: Error & { name: string } = Object.assign(new Error("QuotaExceededError"), {
          name: "QuotaExceededError",
        });
        throw err;
      },
    };
    expect(() =>
      savePanelLayout(
        [{ id: "chart", visible: true }],
        throwing as unknown as Pick<Storage, "setItem">,
      ),
    ).not.to.throw();
  });
});
