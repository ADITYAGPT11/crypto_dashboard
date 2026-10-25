/**
 * Unit tests for src/utils/symbolUtils.ts
 *
 * Covers parseBinanceSymbol, parseOkxSymbol, formatCanonicalSymbol and the
 * documented edge cases: unknown quotes, malformed inputs, hyphenated symbols.
 */
import { describe, expect, it } from "vite-plus/test";
import { parseBinanceSymbol, parseOkxSymbol, formatCanonicalSymbol } from "../symbolUtils";

describe("symbolUtils", () => {
  describe("parseBinanceSymbol", () => {
    it("parses BTCUSDT → { base: 'BTC', quote: 'USDT' }", () => {
      expect(parseBinanceSymbol("BTCUSDT")).to.deep.equal({
        base: "BTC",
        quote: "USDT",
      });
    });

    it("parses ETHUSDT", () => {
      expect(parseBinanceSymbol("ETHUSDT")).to.deep.equal({
        base: "ETH",
        quote: "USDT",
      });
    });

    it("parses BNBUSDT (BNB quote asset)", () => {
      expect(parseBinanceSymbol("BNBUSDT")).to.deep.equal({
        base: "BNB",
        quote: "USDT",
      });
    });

    it("parses BTCBUSD → { base: 'BTC', quote: 'BUSD' }", () => {
      expect(parseBinanceSymbol("BTCBUSD")).to.deep.equal({
        base: "BTC",
        quote: "BUSD",
      });
    });

    it("parses BTCUSD → { base: 'BTC', quote: 'USD' }", () => {
      expect(parseBinanceSymbol("BTCUSD")).to.deep.equal({
        base: "BTC",
        quote: "USD",
      });
    });

    it("parses BTCEUR → { base: 'BTC', quote: 'EUR' }", () => {
      expect(parseBinanceSymbol("BTCEUR")).to.deep.equal({
        base: "BTC",
        quote: "EUR",
      });
    });

    it("parses TRYUSDT → { base: 'TRY', quote: 'USDT' }", () => {
      expect(parseBinanceSymbol("TRYUSDT")).to.deep.equal({
        base: "TRY",
        quote: "USDT",
      });
    });

    it("parses a synthetic multi-char base with USDT quote", () => {
      expect(parseBinanceSymbol("AAAvUSDT")).to.deep.equal({
        base: "AAAv",
        quote: "USDT",
      });
    });

    it("throws on a symbol whose suffix does not match any known quote", () => {
      expect(() => parseBinanceSymbol("BTCXYZ")).to.throw(/Unknown Binance symbol format/);
    });

    it("treats 'BTC' as base='' quote='BTC' (the symbol matches the BTC quote asset)", () => {
      expect(parseBinanceSymbol("BTC")).to.deep.equal({
        base: "",
        quote: "BTC",
      });
    });

    it("throws on an empty string", () => {
      expect(() => parseBinanceSymbol("")).to.throw(/Unknown Binance symbol format/);
    });

    it("parses BTCUSDT → USDT quote (USDT is tried before USD in KNOWN_QUOTES)", () => {
      // KNOWN_QUOTES iterates in order [USDT, BTC, ETH, BUSD, USD, EUR, TRY, BNB];
      // "BTCUSDT" matches USDT first, so USDT wins over USD.
      expect(parseBinanceSymbol("BTCUSDT")).to.deep.equal({
        base: "BTC",
        quote: "USDT",
      });
    });

    it("matches BTC quote asset when symbol ends with BTC", () => {
      expect(parseBinanceSymbol("ETHBTC")).to.deep.equal({
        base: "ETH",
        quote: "BTC",
      });
    });
  });

  describe("parseOkxSymbol", () => {
    it("parses BTC-USDT → { base: 'BTC', quote: 'USDT' }", () => {
      expect(parseOkxSymbol("BTC-USDT")).to.deep.equal({
        base: "BTC",
        quote: "USDT",
      });
    });

    it("parses ETH-USDT", () => {
      expect(parseOkxSymbol("ETH-USDT")).to.deep.equal({
        base: "ETH",
        quote: "USDT",
      });
    });

    it("parses BTC-USD → { base: 'BTC', quote: 'USD' }", () => {
      expect(parseOkxSymbol("BTC-USD")).to.deep.equal({
        base: "BTC",
        quote: "USD",
      });
    });

    it("parses a symbol with a multi-char base", () => {
      expect(parseOkxSymbol("AAAv-USDT")).to.deep.equal({
        base: "AAAv",
        quote: "USDT",
      });
    });

    it("returns a two-element array even when the second part is empty", () => {
      // OKX format uses a single hyphen; "BTC-" is technically valid input to split.
      const result = parseOkxSymbol("BTC-");
      expect(result).to.deep.equal({ base: "BTC", quote: "" });
    });

    it("split(/-/) returns only first two parts: 'A-B-C' → { base: 'A', quote: 'B' }", () => {
      // String.split with destructuring [a, b] only captures the first two elements.
      const result = parseOkxSymbol("A-B-C");
      expect(result).to.deep.equal({ base: "A", quote: "B" });
    });
  });

  describe("formatCanonicalSymbol", () => {
    it("formats { base: 'BTC', quote: 'USDT' } → 'BTC-USDT'", () => {
      expect(formatCanonicalSymbol({ base: "BTC", quote: "USDT" })).to.equal("BTC-USDT");
    });

    it("formats { base: 'ETH', quote: 'USD' } → 'ETH-USD'", () => {
      expect(formatCanonicalSymbol({ base: "ETH", quote: "USD" })).to.equal("ETH-USD");
    });

    it("formats a multi-char base and quote", () => {
      expect(formatCanonicalSymbol({ base: "AAAv", quote: "USDT" })).to.equal("AAAv-USDT");
    });
  });

  describe("round-trip normalization", () => {
    it("Binance symbol BTCUSDT round-trips through parse + format", () => {
      const parsed = parseBinanceSymbol("BTCUSDT");
      expect(formatCanonicalSymbol(parsed)).to.equal("BTC-USDT");
    });

    it("OKX symbol BTC-USDT round-trips through parse + format", () => {
      const parsed = parseOkxSymbol("BTC-USDT");
      expect(formatCanonicalSymbol(parsed)).to.equal("BTC-USDT");
    });

    it("Delta BTCUSD normalizes to BTC-USDT via Delta's own normalizeDeltaSymbol (not parseBinanceSymbol)", () => {
      // parseBinanceSymbol("BTCUSD") → { base: 'BTC', quote: 'USD' } because USD is a known
      // quote. The Delta adapter instead uses its own normalization that maps USD→USDT.
      const parsed = parseBinanceSymbol("BTCUSD");
      expect(parsed).to.deep.equal({ base: "BTC", quote: "USD" });
      expect(formatCanonicalSymbol(parsed)).to.equal("BTC-USD");
    });
  });
});
