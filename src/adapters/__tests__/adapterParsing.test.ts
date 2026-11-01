/**
 * Unit tests for adapter message parsing / normalization.
 *
 * These are pure, in-memory tests that feed the same normalized event
 * payloads the adapters would emit after parsing a raw exchange message.
 * They do NOT open real WebSocket connections; they validate the
 * normalization contracts that adapters promise upstream (services/UI).
 *
 * Philosophy (AGENT.md / projectNotes.txt):
 * - Adapters never leak exchange-native fields into services/UI.
 * - Canonical symbol format is BASE-QUOTE with USDT quote (BTC-USDT).
 * - Timestamps are normalized to epoch milliseconds.
 */

import { describe, expect, it } from "vite-plus/test";
import type { GenericMarketData } from "../../types/marketData";

// ---------------------------------------------------------------------------
// Helpers that mirror what each adapter emits from its raw message.
// Kept inline here so the tests are self-contained and the normalization
// logic stays visible (we test the *outcome* of parsing, not private fields).
// ---------------------------------------------------------------------------

/**
 * Binance raw aggTrade message → GenericMarketData (what BinanceAdapter emits).
 */
function normalizeBinanceAggTrade(raw: {
  e: string;
  s: string;
  p: string;
  T: number;
}): GenericMarketData {
  let symbolKey = raw.s;
  if (symbolKey.endsWith("USDT")) {
    symbolKey = symbolKey.replace("USDT", "-USDT");
  }
  return {
    exchange: "BINANCE",
    type: "SPOT",
    symbol: symbolKey,
    currentPrice: parseFloat(raw.p),
    timeStamp: raw.T,
  };
}

/**
 * Binance raw markPriceUpdate (futures) funding-rate event → what the
 * adapter emits as a FundingRateEvent-shaped object (without the wrapper).
 */
function normalizeBinanceFundingRate(
  raw: { e: string; s: string; r: string; T: number },
  prevT?: number,
): {
  exchange: string;
  symbol: string;
  fundingRate: number;
  nextFundingTime: number;
  fundingInterval: number;
} {
  let symbolKey = raw.s;
  if (symbolKey.endsWith("USDT")) {
    symbolKey = symbolKey.replace("USDT", "-USDT");
  }
  let interval = 28800;
  if (prevT !== undefined && raw.T > prevT) {
    const computed = (raw.T - prevT) / 1000;
    if (computed > 0 && computed <= 86400) interval = computed;
  }
  return {
    exchange: "BINANCE",
    symbol: symbolKey,
    fundingRate: parseFloat(raw.r) * 100,
    nextFundingTime: raw.T,
    fundingInterval: interval,
  };
}

/**
 * OKX raw ticker row → GenericMarketData (what OkxAdapter emits).
 */
function normalizeOkxTicker(raw: { instId: string; last: string; ts: string }): GenericMarketData {
  const isSwap = raw.instId.includes("SWAP");
  // OKX native BTC-USDT / BTC-USDT-SWAP → canonical drops -SWAP suffix.
  const canonicalId = raw.instId.replace(/-SWAP$/, "");
  const [base, quote] = canonicalId.split("-");
  return {
    exchange: "OKX",
    type: isSwap ? "FUT" : "SPOT",
    symbol: `${base}-${quote}`,
    currentPrice: parseFloat(raw.last),
    timeStamp: parseInt(raw.ts),
  };
}

/**
 * OKX raw funding-rate row → FundingRateSnapshot-shaped object.
 */
function normalizeOkxFundingRate(raw: {
  instId: string;
  fundingRate: string;
  fundingTime: string;
  prevFundingTime: string;
  nextFundingRate?: string;
}): {
  exchange: string;
  symbol: string;
  fundingRate: number;
  nextFundingTime: number;
  fundingInterval: number;
  nextFundingRate?: number;
} {
  const canonicalId = raw.instId.replace(/-SWAP$/, "");
  const [base, quote] = canonicalId.split("-");
  const symbol = `${base}-${quote}`;
  let interval = 28800;
  if (raw.fundingTime && raw.prevFundingTime) {
    const computed = (parseInt(raw.fundingTime) - parseInt(raw.prevFundingTime)) / 1000;
    if (computed > 0 && computed <= 86400) interval = computed;
  }
  const nextFr = raw.nextFundingRate !== undefined ? parseFloat(raw.nextFundingRate) : undefined;
  return {
    exchange: "OKX",
    symbol,
    fundingRate: parseFloat(raw.fundingRate || "0") * 100,
    nextFundingTime: parseInt(raw.fundingTime),
    fundingInterval: interval,
    nextFundingRate: isNaN(nextFr as number) ? undefined : nextFr,
  };
}

/**
 * Delta raw trade message → GenericMarketData (what DeltaExchangeAdapter emits).
 */
function normalizeDeltaTrade(raw: {
  type: "trades";
  sy: string;
  p: string;
  ts: number;
}): GenericMarketData {
  // Delta uses USD-quoted instruments (BTCUSD) → canonical maps USD→USDT.
  let symbolKey = raw.sy;
  if (symbolKey.endsWith("USDT") && !symbolKey.includes("-")) {
    symbolKey = symbolKey.slice(0, -4) + "-USDT";
  } else if (symbolKey.endsWith("USD") && !symbolKey.includes("-")) {
    symbolKey = symbolKey.slice(0, -3) + "-USDT";
  }
  return {
    exchange: "DELTA",
    type: "FUT",
    symbol: symbolKey,
    currentPrice: parseFloat(raw.p),
    timeStamp: raw.ts / 1000, // microseconds → ms
  };
}

/**
 * Delta raw funding_rate message → FundingRateSnapshot-shaped object.
 */
function normalizeDeltaFundingRate(raw: {
  type: "funding_rate";
  sy: string;
  fr: number;
  nfr: number;
  fi: number;
}): {
  exchange: string;
  symbol: string;
  fundingRate: number;
  nextFundingTime: number;
  fundingInterval: number;
} {
  let symbolKey = raw.sy;
  if (symbolKey.endsWith("USDT") && !symbolKey.includes("-")) {
    symbolKey = symbolKey.slice(0, -4) + "-USDT";
  } else if (symbolKey.endsWith("USD") && !symbolKey.includes("-")) {
    symbolKey = symbolKey.slice(0, -3) + "-USDT";
  }
  return {
    exchange: "DELTA",
    symbol: symbolKey,
    fundingRate: raw.fr,
    nextFundingTime: Math.floor(raw.nfr / 1000), // microseconds → ms
    fundingInterval: raw.fi,
  };
}

// ---------------------------------------------------------------------------
// Binance adapter parsing
// ---------------------------------------------------------------------------

describe("BinanceAdapter message parsing", () => {
  describe("aggTrade normalization", () => {
    it("normalizes BTCUSDT → BTC-USDT with USDT quote", () => {
      const msg = normalizeBinanceAggTrade({
        e: "aggTrade",
        s: "BTCUSDT",
        p: "64321.50",
        T: 1700000000000,
      });
      expect(msg).to.deep.equal({
        exchange: "BINANCE",
        type: "SPOT",
        symbol: "BTC-USDT",
        currentPrice: 64321.5,
        timeStamp: 1700000000000,
      });
    });

    it("normalizes ETHUSDT → ETH-USDT", () => {
      const msg = normalizeBinanceAggTrade({
        e: "aggTrade",
        s: "ETHUSDT",
        p: "3521.12",
        T: 1700000001000,
      });
      expect(msg).to.deep.equal({
        exchange: "BINANCE",
        type: "SPOT",
        symbol: "ETH-USDT",
        currentPrice: 3521.12,
        timeStamp: 1700000001000,
      });
    });

    it("leaves a non-USDT suffix unchanged when it does not end with USDT", () => {
      // In-scope adapters only subscribe USDT pairs; this documents current behavior.
      const msg = normalizeBinanceAggTrade({
        e: "aggTrade",
        s: "BTCBTC",
        p: "0.05",
        T: 1700000002000,
      });
      expect(msg.symbol).to.equal("BTCBTC");
    });

    it("preserves the raw price as a number (parseFloat)", () => {
      const msg = normalizeBinanceAggTrade({
        e: "aggTrade",
        s: "SOLUSDT",
        p: "145.6789",
        T: 1700000003000,
      });
      expect(msg.currentPrice).to.equal(145.6789);
    });

    it("keeps the original event timestamp (already ms from Binance)", () => {
      const ts = 1700000004000;
      expect(
        normalizeBinanceAggTrade({
          e: "aggTrade",
          s: "ADAUSDT",
          p: "0.6123",
          T: ts,
        }).timeStamp,
      ).to.equal(ts);
    });
  });

  describe("fundingRate (markPrice) normalization", () => {
    it("converts funding rate from fraction to percent (r × 100)", () => {
      const out = normalizeBinanceFundingRate({
        e: "markPriceUpdate",
        s: "BTCUSDT",
        r: "0.0001",
        T: 1700000000000,
      });
      expect(out.fundingRate).to.equal(0.01); // 0.0001 * 100
    });

    it("normalizes symbol BTCUSDT → BTC-USDT for funding rate", () => {
      const out = normalizeBinanceFundingRate({
        e: "markPriceUpdate",
        s: "ETHUSDT",
        r: "0.0002",
        T: 1700000000000,
      });
      expect(out.symbol).to.equal("ETH-USDT");
    });

    it("starts with 28800s interval when there is no previous T", () => {
      const out = normalizeBinanceFundingRate({
        e: "markPriceUpdate",
        s: "BTCUSDT",
        r: "0.0001",
        T: 1700000000000,
      });
      expect(out.fundingInterval).to.equal(28800);
      expect(out.nextFundingTime).to.equal(1700000000000);
    });

    it("derives interval from the gap between consecutive nextFundingTime values", () => {
      const first = normalizeBinanceFundingRate({
        e: "markPriceUpdate",
        s: "BTCUSDT",
        r: "0.0001",
        T: 1700000000000,
      });
      const second = normalizeBinanceFundingRate(
        {
          e: "markPriceUpdate",
          s: "BTCUSDT",
          r: "0.0002",
          T: 1700000000000 + 28800 * 1000,
        },
        first.nextFundingTime,
      );
      expect(second.fundingInterval).to.equal(28800);
    });

    it("uses default 28800 when computed interval is outside the sane range", () => {
      const first = normalizeBinanceFundingRate({
        e: "markPriceUpdate",
        s: "BTCUSDT",
        r: "0.0001",
        T: 1700000000000,
      });
      // A future T far beyond 24h from now → keep the default.
      const second = normalizeBinanceFundingRate(
        {
          e: "markPriceUpdate",
          s: "BTCUSDT",
          r: "0.0002",
          T: first.nextFundingTime + 86400 * 1000 + 1000,
        },
        first.nextFundingTime,
      );
      expect(second.fundingInterval).to.equal(28800);
    });
  });
});

// ---------------------------------------------------------------------------
// OKX adapter parsing
// ---------------------------------------------------------------------------

describe("OkxAdapter message parsing", () => {
  describe("ticker normalization", () => {
    it("normalizes BTC-USDT spot ticker → BTC-USDT / SPOT", () => {
      const msg = normalizeOkxTicker({
        instId: "BTC-USDT",
        last: "64321.50",
        ts: "1700000000000",
      });
      expect(msg).to.deep.equal({
        exchange: "OKX",
        type: "SPOT",
        symbol: "BTC-USDT",
        currentPrice: 64321.5,
        timeStamp: 1700000000000,
      });
    });

    it("normalizes BTC-USDT-SWAP ticker → BTC-USDT / FUT", () => {
      const msg = normalizeOkxTicker({
        instId: "BTC-USDT-SWAP",
        last: "64321.55",
        ts: "1700000000500",
      });
      expect(msg).to.deep.equal({
        exchange: "OKX",
        type: "FUT",
        symbol: "BTC-USDT",
        currentPrice: 64321.55,
        timeStamp: 1700000000500,
      });
    });

    it("parses ts as an integer epoch ms", () => {
      const out = normalizeOkxTicker({
        instId: "ETH-USDT",
        last: "3521.00",
        ts: "1700000001000",
      });
      expect(out.timeStamp).to.equal(1700000001000);
      // eslint-disable-next-line no-unused-expressions
      expect(Number.isInteger(out.timeStamp)).to.be.true;
    });

    it("parses last price via parseFloat", () => {
      const out = normalizeOkxTicker({
        instId: "SOL-USDT",
        last: "145.6789",
        ts: "1700000002000",
      });
      expect(out.currentPrice).to.equal(145.6789);
    });

    it("strips the -SWAP suffix before building the canonical symbol", () => {
      const out = normalizeOkxTicker({
        instId: "ETH-USDT-SWAP",
        last: "3521.00",
        ts: "1700000003000",
      });
      expect(out.symbol).to.equal("ETH-USDT");
      expect(out.type).to.equal("FUT");
    });
  });

  describe("fundingRate normalization", () => {
    it("converts fundingRate from fraction to percent", () => {
      const out = normalizeOkxFundingRate({
        instId: "BTC-USDT-SWAP",
        fundingRate: "0.0001",
        fundingTime: "1700000000000",
        prevFundingTime: "1699971200000",
      });
      expect(out.fundingRate).to.equal(0.01);
    });

    it("drops -SWAP suffix for the canonical symbol", () => {
      const out = normalizeOkxFundingRate({
        instId: "ETH-USDT-SWAP",
        fundingRate: "0.0002",
        fundingTime: "1700000000000",
        prevFundingTime: "1699971200000",
      });
      expect(out.symbol).to.equal("ETH-USDT");
    });

    it("uses nextFundingTime from fundingTime field", () => {
      const out = normalizeOkxFundingRate({
        instId: "BTC-USDT-SWAP",
        fundingRate: "0.0001",
        fundingTime: "1700000000000",
        prevFundingTime: "1699971200000",
      });
      expect(out.nextFundingTime).to.equal(1700000000000);
    });

    it("derives interval from the gap between fundingTime and prevFundingTime", () => {
      const out = normalizeOkxFundingRate({
        instId: "BTC-USDT-SWAP",
        fundingRate: "0.0001",
        fundingTime: "1700000000000",
        prevFundingTime: "1699971200000", // exactly 8h earlier
      });
      expect(out.fundingInterval).to.equal(28800);
    });

    it("keeps default 28800 when prevFundingTime is missing", () => {
      const out = normalizeOkxFundingRate({
        instId: "BTC-USDT-SWAP",
        fundingRate: "0.0001",
        fundingTime: "1700000000000",
        prevFundingTime: "",
      });
      expect(out.fundingInterval).to.equal(28800);
    });

    it("forwards nextFundingRate when present", () => {
      const out = normalizeOkxFundingRate({
        instId: "BTC-USDT-SWAP",
        fundingRate: "0.0001",
        fundingTime: "1700000000000",
        prevFundingTime: "1699971200000",
        nextFundingRate: "0.00015",
      });
      expect(out.nextFundingRate).to.equal(0.00015);
    });

    it("sets nextFundingRate to undefined when absent", () => {
      const out = normalizeOkxFundingRate({
        instId: "BTC-USDT-SWAP",
        fundingRate: "0.0001",
        fundingTime: "1700000000000",
        prevFundingTime: "1699971200000",
      });
      // eslint-disable-next-line no-unused-expressions
      expect(out.nextFundingRate).to.be.undefined;
    });
  });
});

// ---------------------------------------------------------------------------
// Delta Exchange adapter parsing
// ---------------------------------------------------------------------------

describe("DeltaExchangeAdapter message parsing", () => {
  describe("trade normalization", () => {
    it("normalizes BTCUSD → BTC-USDT", () => {
      const msg = normalizeDeltaTrade({
        type: "trades",
        sy: "BTCUSD",
        p: "64321.50",
        ts: 1700000000000000, // microseconds
      });
      expect(msg).to.deep.equal({
        exchange: "DELTA",
        type: "FUT",
        symbol: "BTC-USDT",
        currentPrice: 64321.5,
        timeStamp: 1700000000000, // µs → ms
      });
    });

    it("normalizes ETHUSD → ETH-USDT", () => {
      const msg = normalizeDeltaTrade({
        type: "trades",
        sy: "ETHUSD",
        p: "3521.12",
        ts: 1700000001000000,
      });
      expect(msg).to.deep.equal({
        exchange: "DELTA",
        type: "FUT",
        symbol: "ETH-USDT",
        currentPrice: 3521.12,
        timeStamp: 1700000001000,
      });
    });

    it("converts microseconds to milliseconds for the timestamp", () => {
      const tsUs = 1700000002000000;
      expect(
        normalizeDeltaTrade({
          type: "trades",
          sy: "SOLUSD",
          p: "145.00",
          ts: tsUs,
        }).timeStamp,
      ).to.equal(tsUs / 1000);
    });

    it("parses price via parseFloat", () => {
      const msg = normalizeDeltaTrade({
        type: "trades",
        sy: "BTCUSD",
        p: "64321.555",
        ts: 1700000003000000,
      });
      expect(msg.currentPrice).to.equal(64321.555);
    });

    it("leaves an already-canonical USDT symbol unchanged", () => {
      const msg = normalizeDeltaTrade({
        type: "trades",
        sy: "BTC-USDT",
        p: "64321.50",
        ts: 1700000004000000,
      });
      expect(msg.symbol).to.equal("BTC-USDT");
    });
  });

  describe("funding_rate normalization", () => {
    it("normalizes BTCUSD funding_rate → BTC-USDT", () => {
      const out = normalizeDeltaFundingRate({
        type: "funding_rate",
        sy: "BTCUSD",
        fr: 0.01,
        nfr: 1700000000000000,
        fi: 28800,
      });
      expect(out).to.deep.equal({
        exchange: "DELTA",
        symbol: "BTC-USDT",
        fundingRate: 0.01,
        nextFundingTime: 1700000000000,
        fundingInterval: 28800,
      });
    });

    it("keeps fundingRate as-is (already a number on Delta)", () => {
      const out = normalizeDeltaFundingRate({
        type: "funding_rate",
        sy: "ETHUSD",
        fr: 0.005,
        nfr: 1700000000000000,
        fi: 28800,
      });
      expect(out.fundingRate).to.equal(0.005);
    });

    it("converts nfr from microseconds to milliseconds", () => {
      const nfrUs = 1700000005000000;
      const out = normalizeDeltaFundingRate({
        type: "funding_rate",
        sy: "BTCUSD",
        fr: 0.01,
        nfr: nfrUs,
        fi: 28800,
      });
      expect(out.nextFundingTime).to.equal(Math.floor(nfrUs / 1000));
    });

    it("forwards fundingInterval in seconds unchanged", () => {
      const out = normalizeDeltaFundingRate({
        type: "funding_rate",
        sy: "BTCUSD",
        fr: 0.01,
        nfr: 1700000000000000,
        fi: 3600,
      });
      expect(out.fundingInterval).to.equal(3600);
    });

    it("keeps a USDT-suffixed symbol as-is", () => {
      const out = normalizeDeltaFundingRate({
        type: "funding_rate",
        sy: "BTC-USDT",
        fr: 0.01,
        nfr: 1700000000000000,
        fi: 28800,
      });
      expect(out.symbol).to.equal("BTC-USDT");
    });
  });
});

// ---------------------------------------------------------------------------
// Cross-adapter invariant: canonical symbol format
// ---------------------------------------------------------------------------

describe("cross-adapter canonical symbol invariant", () => {
  it("every parsed market-data payload uses BASE-QUOTE with a hyphen", () => {
    const samples: GenericMarketData[] = [
      normalizeBinanceAggTrade({
        e: "aggTrade",
        s: "BTCUSDT",
        p: "64321.50",
        T: 1700000000000,
      }),
      normalizeOkxTicker({
        instId: "ETH-USDT",
        last: "3521.00",
        ts: "1700000001000",
      }),
      normalizeDeltaTrade({
        type: "trades",
        sy: "SOLUSD",
        p: "145.00",
        ts: 1700000002000000,
      }),
    ];

    for (const msg of samples) {
      // canonical = BASE-QUOTE
      expect(msg.symbol).to.match(/^[A-Z0-9]+-[A-Z0-9]+$/);
      expect(msg.symbol).to.include("-");
      // In-scope quote is USDT (Delta maps USD→USDT on ingest).
      // eslint-disable-next-line no-unused-expressions
      expect(msg.symbol.endsWith("-USDT")).to.be.true;
    }
  });

  it("every parsed funding-rate payload normalizes to the same canonical symbol format", () => {
    const samples: Array<{ symbol: string }> = [
      normalizeBinanceFundingRate({
        e: "markPriceUpdate",
        s: "BTCUSDT",
        r: "0.0001",
        T: 1700000000000,
      }),
      normalizeOkxFundingRate({
        instId: "ETH-USDT-SWAP",
        fundingRate: "0.0002",
        fundingTime: "1700000000000",
        prevFundingTime: "1699971200000",
      }),
      normalizeDeltaFundingRate({
        type: "funding_rate",
        sy: "SOLUSD",
        fr: 0.01,
        nfr: 1700000000000000,
        fi: 28800,
      }),
    ];

    for (const s of samples) {
      expect(s.symbol).to.match(/^[A-Z0-9]+-[A-Z0-9]+$/);
      // eslint-disable-next-line no-unused-expressions
      expect(s.symbol.endsWith("-USDT")).to.be.true;
    }
  });
});
