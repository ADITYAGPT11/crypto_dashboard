/**
 * Unit tests for 24h ticker-stats parsing (utils) and the compact display
 * formatters over priceUtils. Fixtures are the raw exchange JSON shapes.
 */
import { describe, expect, it } from "vite-plus/test";
import { parseBinance24hTicker, parseOkx24hTicker, type ParsedTickerStats } from "../tickerStats";
import {
  formatCompact,
  formatCompactQty,
  formatCompactUsd,
  formatSignedPercent,
} from "../priceUtils";

// ---------------------------------------------------------------------------
// Binance /api/v3 + /fapi 24hr ticker rows
// ---------------------------------------------------------------------------

const BINANCE_ROW = {
  symbol: "BTCUSDT",
  priceChange: "-150.24",
  priceChangePercent: "-0.186",
  lastPrice: "80662.83",
  openPrice: "80813.07",
  volume: "109026.761",
  quoteVolume: "8747891293.26",
};

describe("parseBinance24hTicker", () => {
  it("extracts the percent string directly (already a percentage)", () => {
    const out: ParsedTickerStats | null = parseBinance24hTicker(BINANCE_ROW);
    expect(out).not.to.equal(null);
    expect(out?.changePercent).to.equal(-0.186);
    expect(out?.volumeBase).to.equal(109026.761);
  });

  it("keeps nulls when a field is missing", () => {
    const out = parseBinance24hTicker({ volume: "12.5" });
    expect(out?.changePercent).to.equal(null);
    expect(out?.volumeBase).to.equal(12.5);
  });

  it("returns null for values that never parse", () => {
    expect(parseBinance24hTicker({ priceChangePercent: "abc", volume: "abc" })).to.equal(null);
  });

  it("returns null for garbage shapes", () => {
    expect(parseBinance24hTicker(null)).to.equal(null);
    expect(parseBinance24hTicker("nope")).to.equal(null);
    expect(parseBinance24hTicker({ data: [] })).to.equal(null);
  });
});

// ---------------------------------------------------------------------------
// OKX /api/v5/market/ticker rows
// ---------------------------------------------------------------------------

const OKX_ROW = {
  code: "0",
  data: [
    {
      instId: "BTC-USDT",
      last: "80662.8",
      open24h: "80813.0",
      vol24h: "109026.7",
      volCcy24h: "109026.7", // base-asset volume
    },
  ],
};

describe("parseOkx24hTicker", () => {
  it("derives the change percent from last vs open24h", () => {
    const out = parseOkx24hTicker(OKX_ROW);
    expect(out?.changePercent).to.be.closeTo(-0.1859, 0.0005);
    expect(out?.volumeBase).to.equal(109026.7);
  });

  it("handles an SWAP payload the same way", () => {
    const out = parseOkx24hTicker({
      code: "0",
      data: [{ instId: "BTC-USDT-SWAP", last: "100", open24h: "50", volCcy24h: "3" }],
    });
    expect(out?.changePercent).to.equal(100);
    expect(out?.volumeBase).to.equal(3);
  });

  it("returns null percentages when open24h is zero", () => {
    const out = parseOkx24hTicker({
      code: "0",
      data: [{ instId: "X-USDT", last: "1", open24h: "0", volCcy24h: "2" }],
    });
    expect(out?.changePercent).to.equal(null);
    expect(out?.volumeBase).to.equal(2);
  });

  it("returns null for garbage shapes", () => {
    expect(parseOkx24hTicker(null)).to.equal(null);
    expect(parseOkx24hTicker({ data: "no" })).to.equal(null);
    expect(parseOkx24hTicker({ code: "0", data: [] })).to.equal(null);
  });
});

// ---------------------------------------------------------------------------
// Display formatters (priceUtils)
// ---------------------------------------------------------------------------

describe("formatCompact family", () => {
  it("uses K/M/B/T suffixes with two decimals and trimmed zeros", () => {
    expect(formatCompact(109026.761)).to.equal("109.03K");
    expect(formatCompact(8747891293.26)).to.equal("8.75B");
    expect(formatCompact(1_250_000)).to.equal("1.25M");
    expect(formatCompact(1000.4)).to.equal("1K"); // 1.0004K → zeros trimmed
    expect(formatCompact(999.99)).to.equal("999.99"); // below the K tier
    expect(formatCompact(523.4)).to.equal("523.4");
  });

  it("keeps a sign on negative magnitudes", () => {
    expect(formatCompact(-1250)).to.equal("-1.25K");
  });

  it("degrades non-finite/null to an em dash", () => {
    expect(formatCompact(Number.NaN)).to.equal("—");
    expect(formatCompactQty(null)).to.equal("—");
    expect(formatCompactUsd(null)).to.equal("—");
  });

  it("prefixes the USD variant", () => {
    expect(formatCompactUsd(8747891293.26)).to.equal("$8.75B");
  });
});

describe("formatSignedPercent", () => {
  it("adds a + sign to positives and keeps negatives", () => {
    expect(formatSignedPercent(0.186)).to.equal("+0.19%");
    expect(formatSignedPercent(-0.186)).to.equal("-0.19%");
  });

  it("renders small movers as plain 0%", () => {
    expect(formatSignedPercent(0)).to.equal("0%");
    expect(formatSignedPercent(0.001)).to.equal("0%");
  });

  it("degrades null/NaN to an em dash", () => {
    expect(formatSignedPercent(null)).to.equal("—");
    expect(formatSignedPercent(Number.NaN)).to.equal("—");
  });
});
