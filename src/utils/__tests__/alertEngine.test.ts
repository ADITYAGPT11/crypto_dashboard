/**
 * Replay tests for the pure alert engine (Module 6).
 *
 * Each "replay" feeds a recorded series of contexts through the engine while
 * carrying state forward, exactly like the live loop will, and asserts the
 * triggers (and their absence) deterministically.
 */
import { describe, expect, it } from "vite-plus/test";
import {
  collectRuleTargets,
  evaluateAlertRule,
  evaluateAlertRules,
} from "../../services/AlertEngine";
import type {
  AlertCondition,
  AlertEngineContext,
  AlertEngineState,
  AlertRule,
} from "../../types/alertRules";
import type { Candle, OrderBookSnapshot } from "../../types/marketData";
import { parseAlertRules, parseCondition, parseTriggerLog } from "../alertRulesStorage";

const EMPTY_STATE: AlertEngineState = { lastFiredAt: {} };

function mkContext(over: Partial<AlertEngineContext> = {}): AlertEngineContext {
  return {
    now: 1_000_000,
    candles: new Map(),
    books: new Map(),
    prices: new Map(),
    ...over,
  };
}

function mkCandles(closes: number[], intervalMs = 60_000): Candle[] {
  const candles: Candle[] = closes.map((close, i) => ({
    openTime: mapStart + i * intervalMs,
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    volume: 10,
    closed: true,
  }));
  // make mapStart reachable
  return candles;
}

const mapStart = 0;

function rule(
  id: string,
  combine: AlertRule["combine"],
  conditions: AlertCondition[],
  over: Partial<AlertRule> = {},
): AlertRule {
  return {
    id,
    name: id,
    enabled: true,
    combine,
    evaluation: "candle_close",
    cooldownMs: 60_000,
    conditions,
    createdAt: 0,
    ...over,
  };
}

function book(bidQty: number, askQty: number): OrderBookSnapshot {
  return {
    exchange: "BINANCE",
    symbol: "BTC-USDT",
    type: "SPOT",
    bestBid: 64_000,
    bestBidQty: bidQty,
    bestAsk: 64_001,
    bestAskQty: askQty,
    midPrice: 64_000.5,
    bids: [{ price: 64_000, quantity: bidQty, updatedAt: 0 }],
    asks: [{ price: 64_001, quantity: askQty, updatedAt: 0 }],
    updatedAt: 0,
  };
}

describe("priceCross conditions", () => {
  const cond: AlertCondition = {
    kind: "priceCross",
    exchange: "BINANCE",
    type: "SPOT",
    symbol: "BTC-USDT",
    direction: "above",
    value: 65_000,
  };
  const r = rule("cross", "ANY", [cond], { cooldownMs: 0 });

  it("fires only on the crossing update", () => {
    const ctx1 = mkContext({
      prices: new Map([["BINANCE|SPOT|BTC-USDT", { prev: 64_999, current: 65_001 }]]),
    });
    const { trigger, state } = evaluateAlertRule(r, ctx1, EMPTY_STATE);
    expect(trigger?.reason).toContain("crossed above");
    expect(state.lastFiredAt.cross).to.equal(ctx1.now);
  });

  it("does not fire while price merely sits above the level", () => {
    const ctx = mkContext({
      prices: new Map([["BINANCE|SPOT|BTC-USDT", { prev: 65_002, current: 65_003 }]]),
    });
    expect(evaluateAlertRule(r, ctx, EMPTY_STATE).trigger).to.equal(null);
  });

  it("fires once going below and not without a previous price", () => {
    const below = rule("xb", "ANY", [{ ...cond, direction: "below" }], { cooldownMs: 0 });
    const cross = mkContext({
      prices: new Map([["BINANCE|SPOT|BTC-USDT", { prev: 65_001, current: 64_999 }]]),
    });
    expect(evaluateAlertRule(below, cross, EMPTY_STATE).trigger).to.not.equal(null);

    const noHistory = mkContext({
      prices: new Map([["BINANCE|SPOT|BTC-USDT", { prev: null, current: 64_999 }]]),
    });
    expect(evaluateAlertRule(below, noHistory, EMPTY_STATE).trigger).to.equal(null);
  });
});

describe("candle-based conditions (candle_close replay)", () => {
  const candles = mkCandles([
    100,
    100,
    100,
    100,
    100,
    100, // flat warm-up
    100,
    100,
    100,
    100,
    100,
    100,
    100, // base for 3-bar window
    100,
    104, // +4% over 3 bars
  ]);
  const key = "BINANCE|SPOT|BTC-USDT|15m";

  it("percentMove: fires once on the +4% move, then cooldown suppresses repeats", () => {
    const r = rule("pm", "ANY", [
      {
        kind: "percentMove",
        exchange: "BINANCE",
        type: "SPOT",
        symbol: "BTC-USDT",
        interval: "15m",
        window: 3,
        percent: 3,
        direction: "any",
      },
    ]);

    // Replay up to just before the move: no trigger.
    const before = mkContext({ candles: new Map([[key, candles.slice(0, -1)]]) });
    const pre = evaluateAlertRule(r, { ...before, now: 1_000 }, EMPTY_STATE);
    expect(pre.trigger).to.equal(null);

    // Replay the trigger bar.
    const ctx = mkContext({ candles: new Map([[key, candles]]) });
    const fired = evaluateAlertRule(r, { ...ctx, now: 2_000 }, EMPTY_STATE);
    expect(fired.trigger).to.not.equal(null);
    expect(fired.trigger?.reason).toContain("+4");

    // Same conditions one tick later (within cooldown) → suppressed.
    const again = evaluateAlertRule(r, { ...ctx, now: 30_000 }, fired.state);
    expect(again.trigger).to.equal(null);

    // After cooldown with the same data → fires again (documented behavior:
    // cooldown dedupe is time-based; the live UI continues past it).
    const after = evaluateAlertRule(r, { ...ctx, now: 62_000 }, fired.state);
    expect(after.trigger).to.not.equal(null);
  });

  it("percentMove ignores unclosed candles in candle_close mode", () => {
    const withOpen = [...candles, { ...candles[0], close: 200, closed: false }];
    const r = rule("pm2", "ANY", [
      {
        kind: "percentMove",
        exchange: "BINANCE",
        type: "SPOT",
        symbol: "BTC-USDT",
        interval: "15m",
        window: 3,
        percent: 3,
        direction: "any",
      },
    ]);
    const ctx = mkContext({ candles: new Map([[key, withOpen]]) });
    const res = evaluateAlertRule({ ...r, cooldownMs: 0 }, { ...ctx, now: 5_000 }, EMPTY_STATE);
    // Only closed candles are used → move is the preexisting +4% one → fires once.
    expect(res.trigger).to.not.equal(null);
    expect(res.trigger?.values["close"]).to.equal(undefined);
  });

  it("volumeSpike fires when the last closed bar spikes over the multiplier", () => {
    const spiky: Candle[] = mkCandles(Array(20).fill(100));
    spiky[spiky.length - 1] = { ...spiky[spiky.length - 1], volume: 100, closed: true };
    const r = rule("vs", "ANY", [
      {
        kind: "volumeSpike",
        exchange: "BINANCE",
        type: "SPOT",
        symbol: "BTC-USDT",
        interval: "1m",
        lookback: 10,
        multiplier: 3,
      },
    ]);
    const ctx = mkContext({ candles: new Map([["BINANCE|SPOT|BTC-USDT|1m", spiky]]) });
    const res = evaluateAlertRule({ ...r, cooldownMs: 0 }, { ...ctx, now: 3_000 }, EMPTY_STATE);
    expect(res.trigger?.reason).toContain("10× mean");
  });

  it("indicatorThreshold: RSI threshold evaluates on closes", () => {
    // Construct a synthetic RSI(14) well below 30 via predominantly falling closes.
    const falling: number[] = [];
    for (let i = 0; i < 30; i++) falling.push(100 - i);
    const ctx = mkContext({
      candles: new Map([["BINANCE|SPOT|BTC-USDT|1m", mkCandles(falling)]]),
    });
    const r = rule("rsiRule", "ANY", [
      {
        kind: "indicatorThreshold",
        exchange: "BINANCE",
        type: "SPOT",
        symbol: "BTC-USDT",
        interval: "1m",
        indicator: "rsi",
        period: 14,
        operator: "<",
        value: 30,
      },
    ]);
    const res = evaluateAlertRule({ ...r, cooldownMs: 0 }, { ...ctx, now: 4_000 }, EMPTY_STATE);
    const rsiValue = Number(res.trigger?.values.rsi);
    expect(res.trigger).to.not.equal(null);
    expect(rsiValue).to.be.lessThan(30);
  });

  it("intrabar evaluation accepts the live open candle, candle_close does not", () => {
    const closed = mkCandles(Array(10).fill(100));
    const live = { ...closed[0], openTime: mapStart + 10 * 60_000, close: 200, closed: false };
    const withLive = [...closed, live];
    const cond: AlertCondition = {
      kind: "percentMove",
      exchange: "BINANCE",
      type: "SPOT",
      symbol: "BTC-USDT",
      interval: "1m",
      window: 9,
      percent: 10,
      direction: "any",
    };
    const intrabar = evaluateAlertRule(
      rule("intra", "ANY", [cond], { evaluation: "intrabar", cooldownMs: 0 }),
      mkContext({ candles: new Map([["BINANCE|SPOT|BTC-USDT|1m", withLive]]) }),
      EMPTY_STATE,
    );
    expect(intrabar.trigger).to.not.equal(null);

    const closeOnly = evaluateAlertRule(
      rule("close", "ANY", [cond]),
      mkContext({ candles: new Map([["BINANCE|SPOT|BTC-USDT|1m", withLive]]) }),
      EMPTY_STATE,
    );
    expect(closeOnly.trigger).to.equal(null);
  });
});

describe("book conditions", () => {
  it("bookImbalance fires beyond the threshold", () => {
    const ctx = mkContext({ books: new Map([["BINANCE|SPOT|BTC-USDT", book(9, 1)]]) });
    const r = rule("imb", "ANY", [
      {
        kind: "bookImbalance",
        exchange: "BINANCE",
        type: "SPOT",
        symbol: "BTC-USDT",
        topN: 5,
        operator: ">",
        threshold: 0.7,
      },
    ]);
    const res = evaluateAlertRule({ ...r, cooldownMs: 0 }, { ...ctx, now: 6_000 }, EMPTY_STATE);
    expect(res.trigger).to.not.equal(null); // 9-1 / 10 = 0.8

    const ctx2 = mkContext({ books: new Map([["BINANCE|SPOT|BTC-USDT", book(10, 10)]]) });
    expect(
      evaluateAlertRule({ ...r, cooldownMs: 0 }, { ...ctx2, now: 7_000 }, EMPTY_STATE).trigger,
    ).to.equal(null);
  });

  it("largeLiquidity flags visible levels >= minQuantity", () => {
    const ctx = mkContext({ books: new Map([["BINANCE|SPOT|BTC-USDT", book(12, 1)]]) });
    const r = rule("lli", "ANY", [
      {
        kind: "largeLiquidity",
        exchange: "BINANCE",
        type: "SPOT",
        symbol: "BTC-USDT",
        minQuantity: 10,
      },
    ]);
    expect(
      evaluateAlertRule({ ...r, cooldownMs: 0 }, { ...ctx, now: 8_000 }, EMPTY_STATE).trigger,
    ).to.not.equal(null);
  });
});

describe("combining, cooldown and dedupe", () => {
  const balanceCond: AlertCondition = {
    kind: "priceCross",
    exchange: "BINANCE",
    type: "SPOT",
    symbol: "BTC-USDT",
    direction: "below",
    value: 1,
  };
  const prices = new Map([["BINANCE|SPOT|BTC-USDT", { prev: 5, current: 0.5 }]]);

  it("ALL requires every condition, ANY requires one", () => {
    const imbalance = {
      kind: "bookImbalance",
      exchange: "BINANCE",
      type: "SPOT",
      symbol: "BTC-USDT",
      topN: 5,
      operator: ">",
      threshold: 0.99,
    } as const;
    const ctx = mkContext({ prices, books: new Map([["BINANCE|SPOT|BTC-USDT", book(1, 9)]]) });

    const all = evaluateAlertRule(
      rule("all", "ALL", [balanceCond, imbalance], { cooldownMs: 0 }),
      ctx,
      EMPTY_STATE,
    );
    expect(all.trigger).to.equal(null);

    const any = evaluateAlertRule(
      rule("any", "ANY", [balanceCond, imbalance], { cooldownMs: 0 }),
      ctx,
      EMPTY_STATE,
    );
    expect(any.trigger).to.not.equal(null);
  });

  it("disabled rules never fire", () => {
    const ctx = mkContext({ prices });
    const res = evaluateAlertRule(
      rule("off", "ANY", [balanceCond], { enabled: false }),
      ctx,
      EMPTY_STATE,
    );
    expect(res.trigger).to.equal(null);
    expect(res.state.lastFiredAt["off"]).to.equal(undefined);
  });

  it("cooldown suppresses repeat triggers while the condition stays met", () => {
    const r: AlertRule = rule(
      "imbCool",
      "ANY",
      [
        {
          kind: "bookImbalance",
          exchange: "BINANCE",
          type: "SPOT",
          symbol: "BTC-USDT",
          topN: 5,
          operator: ">",
          threshold: 0.4,
        },
      ],
      { cooldownMs: 60_000 },
    );
    const ctx = mkContext({ now: 10_000, books: new Map([["BINANCE|SPOT|BTC-USDT", book(3, 1)]]) });
    const first = evaluateAlertRule(r, ctx, EMPTY_STATE);
    expect(first.trigger).to.not.equal(null);

    // Condition still met 30s later → suppressed (dedupe).
    const stillInside = evaluateAlertRule(r, { ...ctx, now: 40_000 }, first.state);
    expect(stillInside.trigger).to.equal(null);

    // After the cooldown → fires again.
    const after = evaluateAlertRule(r, { ...ctx, now: 70_001 }, first.state);
    expect(after.trigger).to.not.equal(null);
  });
});

describe("determinism (same input ⇒ same output)", () => {
  it("replaying identical contexts and state yields identical triggers", () => {
    const ctx = mkContext({
      now: 99,
      books: new Map([["BINANCE|SPOT|BTC-USDT", book(8, 2)]]),
    });
    const r: AlertRule = rule(
      "det",
      "ANY",
      [
        {
          kind: "bookImbalance",
          exchange: "BINANCE",
          type: "SPOT",
          symbol: "BTC-USDT",
          topN: 5,
          operator: ">",
          threshold: 0.4,
        },
      ],
      { cooldownMs: 0 },
    );
    const a = evaluateAlertRules([r], ctx, EMPTY_STATE);
    const b = evaluateAlertRules([r], ctx, EMPTY_STATE);
    expect(a.triggers).to.deep.equal(b.triggers);
    expect(a.state).to.deep.equal(b.state);
  });
});

describe("collectRuleTargets (live-wiring data discovery)", () => {
  it("collects candle, book and price keys from enabled rules only", () => {
    const cross = rule("t1", "ANY", [
      {
        kind: "priceCross",
        exchange: "BINANCE",
        type: "SPOT",
        symbol: "BTC-USDT",
        direction: "above",
        value: 65_000,
      },
    ]);
    const mixed = rule("t2", "ANY", [
      {
        kind: "volumeSpike",
        exchange: "BINANCE",
        type: "SPOT",
        symbol: "BTC-USDT",
        interval: "1m",
        lookback: 10,
        multiplier: 3,
      },
      {
        kind: "bookImbalance",
        exchange: "BINANCE",
        type: "SPOT",
        symbol: "ETH-USDT",
        topN: 5,
        operator: ">",
        threshold: 0.5,
      },
    ]);
    const disabled = rule(
      "t3",
      "ANY",
      [
        {
          kind: "largeLiquidity",
          exchange: "OKX",
          type: "FUT",
          symbol: "SOL-USDT",
          minQuantity: 100,
        },
      ],
      { enabled: false },
    );

    const targets = collectRuleTargets([cross, mixed, disabled]);
    expect(targets.candleKeys).to.deep.equal(["BINANCE|SPOT|BTC-USDT|1m"]);
    expect(targets.bookKeys).to.deep.equal(["BINANCE|SPOT|ETH-USDT"]);
    expect(targets.priceKeys).to.deep.equal(["BINANCE|SPOT|BTC-USDT", "BINANCE|SPOT|ETH-USDT"]);
  });
});

describe("storage parsing (alertRulesStorage)", () => {
  it("keeps valid rules and drops malformed ones", () => {
    const valid = rule("ok", "ANY", [
      parseCondition({
        kind: "priceCross",
        exchange: "BINANCE",
        type: "SPOT",
        symbol: "BTC-USDT",
        direction: "below",
        value: 1,
      }) as AlertCondition,
    ]);
    const rows = [
      valid,
      { id: "", name: "no id" },
      { id: "x", name: "no conditions", conditions: [{ kind: "bogus" }] },
      null,
      12,
    ];
    const parsed = parseAlertRules(rows);
    expect(parsed.length).to.equal(1);
    expect(parsed[0].id).to.equal("ok");
    expect(parsed[0].conditions[0].kind).to.equal("priceCross");
  });

  it("drops conditions with unknown exchange/type/symbol/interval", () => {
    expect(
      parseCondition({
        kind: "priceCross",
        exchange: "BOGUS",
        type: "SPOT",
        symbol: "BTC-USDT",
        direction: "above",
        value: 1,
      }),
    ).to.equal(null);
    expect(
      parseCondition({
        kind: "percentMove",
        exchange: "BINANCE",
        type: "SPOT",
        symbol: "BTC-USDT",
        interval: "7m",
        window: 3,
        percent: 5,
        direction: "any",
      }),
    ).to.equal(null);
  });

  it("parses captured trigger logs and ignores malformed rows", () => {
    const row = {
      ruleId: "r1",
      ruleName: "Rule one",
      firedAt: Date.now(),
      values: { rsi: "27" },
      reason: "RSI(14) = 27 <= 30",
    };
    const parsed = parseTriggerLog([row, null, { ruleId: "x" }]);
    expect(parsed.length).to.equal(1);
    expect(parsed[0].values.rsi).to.equal("27");
  });
});
