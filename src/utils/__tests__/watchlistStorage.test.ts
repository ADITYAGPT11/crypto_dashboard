import { describe, expect, it } from "vite-plus/test";
import {
  DEFAULT_WATCHLIST,
  WATCHLIST_STORAGE_KEY,
  loadWatchlist,
  parseWatchlist,
  readStoredWatchlist,
  saveWatchlist,
} from "../watchlistStorage";

/** Minimal in-memory Storage stub so tests never touch globalThis.localStorage. */
function makeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => (data.has(key) ? data.get(key)! : null),
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    entries: () => Object.fromEntries(data.entries()),
  };
}

describe("parseWatchlist", () => {
  it("keeps only well-formed canonical symbols", () => {
    expect(parseWatchlist(["BTC-USDT", "bad", "PEPE-USDT", "ETH-USDT", "", 123, null])).toEqual([
      "BTC-USDT",
      "PEPE-USDT",
      "ETH-USDT",
    ]);
  });

  it("deduplicates while preserving first-seen order", () => {
    expect(parseWatchlist(["ETH-USDT", "BTC-USDT", "ETH-USDT"])).toEqual(["ETH-USDT", "BTC-USDT"]);
  });

  it("caps the list length", () => {
    const many = Array.from({ length: 250 }, (_, i) => `S${i}-USDT`);
    expect(parseWatchlist(many)).toHaveLength(100);
  });

  it("rejects non-array inputs", () => {
    expect(parseWatchlist("BTC-USDT")).toEqual([]);
    expect(parseWatchlist({ symbols: [] })).toEqual([]);
    expect(parseWatchlist(null)).toEqual([]);
  });
});

describe("readStoredWatchlist", () => {
  it("parses a stored JSON array", () => {
    expect(readStoredWatchlist('["BTC-USDT","ETH-USDT"]')).toEqual(["BTC-USDT", "ETH-USDT"]);
  });

  it("returns empty for corrupt JSON", () => {
    expect(readStoredWatchlist("{not json")).toEqual([]);
  });

  it("returns empty for null/undefined", () => {
    expect(readStoredWatchlist(null)).toEqual([]);
    expect(readStoredWatchlist(undefined)).toEqual([]);
  });
});

describe("loadWatchlist", () => {
  it("returns the persisted list when storage has one", () => {
    const storage = makeStorage({ [WATCHLIST_STORAGE_KEY]: '["SOL-USDT","XRP-USDT"]' });
    expect(loadWatchlist(storage)).toEqual(["SOL-USDT", "XRP-USDT"]);
  });

  it("falls back to the default watchlist when storage is empty", () => {
    expect(loadWatchlist(makeStorage())).toEqual([...DEFAULT_WATCHLIST]);
  });

  it("falls back to the default watchlist on corrupt data", () => {
    const storage = makeStorage({ [WATCHLIST_STORAGE_KEY]: "%%%" });
    expect(loadWatchlist(storage)).toEqual([...DEFAULT_WATCHLIST]);
  });

  it("works without any storage available", () => {
    expect(loadWatchlist(undefined)).toEqual([...DEFAULT_WATCHLIST]);
  });
});

describe("saveWatchlist", () => {
  it("writes a cleaned JSON list under the storage key", () => {
    const storage = makeStorage();
    saveWatchlist(["BTC-USDT", "broken!!", "ETH-USDT"], storage);
    expect(JSON.parse(storage.entries()[WATCHLIST_STORAGE_KEY])).toEqual(["BTC-USDT", "ETH-USDT"]);
  });

  it("does not throw when storage is unavailable", () => {
    expect(() => saveWatchlist(["BTC-USDT"], undefined)).not.toThrow();
  });

  it("does not throw when storage rejects writes (quota/private mode)", () => {
    const failing = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(() => saveWatchlist(["BTC-USDT"], failing)).not.toThrow();
  });

  it("round-trips through load", () => {
    const storage = makeStorage();
    saveWatchlist(["AVAX-USDT", "LINK-USDT"], storage);
    expect(loadWatchlist(storage)).toEqual(["AVAX-USDT", "LINK-USDT"]);
  });
});
