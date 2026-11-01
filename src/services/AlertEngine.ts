/**
 * Pure alert-rule evaluation engine (Module 6).
 *
 * No DOM, no services, no exchange types beyond the normalized contracts:
 * everything enters and leaves as plain data so rules can be evaluated (and
 * replayed against fixtures) independently of the UI.
 *
 * Evaluation contract:
 * - rules[].enabled === false → never evaluated.
 * - ALL: every condition holds now; ANY: at least one holds now.
 * - priceCross fires only on the crossing update (prev on one side, current
 *   past the level) — it cannot fire while price merely sits beyond the level.
 * - candle_close mode computes percent-move / volume-spike / indicator
 *   conditions from closed candles only; intrabar mode also accepts the live
 *   open candle.
 * - cooldownMs is both the cooldown and the dedupe: a rule cannot fire again
 *   within cooldownMs of its previous trigger, which suppresses repeat/false
 *   duplicate triggers while a condition stays met.
 * - Equal (rules, ctx, state) ⇒ equal output. No wall-clock reads here: pass
 *   `now` in the context.
 */
import { ema, rsi, sma } from "../utils/indicators";
import { findLargeLevels, imbalanceTopN } from "../utils/orderBookUtils";
import type {
  AlertCondition,
  AlertEngineContext,
  AlertRule,
  AlertTrigger,
} from "../types/alertRules";
import { candleKey, orderBookKey } from "../types/marketData";
import type { Candle, ExchangeName, MarketType, OrderBookSnapshot } from "../types/marketData";

interface ConditionCheck {
  met: boolean;
  reason: string;
  values: Record<string, string>;
}

const fmt = (n: number, d = 2): string =>
  Number.isFinite(n) ? n.toFixed(d).replace(/\.00$/, "") : "unknown";

function checkPriceCross(
  cond: AlertCondition & { kind: "priceCross" },
  ctx: AlertEngineContext,
): ConditionCheck {
  const key = `${cond.exchange}|${cond.type}|${cond.symbol}`;
  const p = ctx.prices.get(key);
  if (!p?.current || p.prev == null) {
    return { met: false, reason: "no price history", values: {} };
  }
  const values = { prev: fmt(p.prev), current: fmt(p.current), level: fmt(cond.value) };
  if (cond.direction === "above") {
    return {
      met: p.prev <= cond.value && p.current > cond.value,
      reason: `price crossed above ${fmt(cond.value)} (${fmt(p.prev)} → ${fmt(p.current)})`,
      values,
    };
  }
  return {
    met: p.prev >= cond.value && p.current < cond.value,
    reason: `price crossed below ${fmt(cond.value)} (${fmt(p.prev)} → ${fmt(p.current)})`,
    values,
  };
}

/**
 * Candles the condition may use under the rule's evaluation mode:
 * closed candles only, or closed + the live open candle for intrabar.
 */
function usableCandles(
  candles: Candle[],
  evaluation: AlertRule["evaluation"],
  max: number,
): Candle[] {
  let usable = evaluation === "candle_close" ? candles.filter((c) => c.closed === true) : candles;
  usable = usable.slice(-max);
  return usable;
}

function candleKeyOf(cond: {
  exchange: string;
  type: string;
  symbol: string;
  interval?: string;
}): string {
  return candleKey(cond.exchange as never, cond.type as never, cond.symbol, cond.interval as never);
}

function checkPercentMove(
  cond: Extract<AlertCondition, { kind: "percentMove" }>,
  evaluation: AlertRule["evaluation"],
  ctx: AlertEngineContext,
): ConditionCheck {
  const candles = usableCandles(
    ctx.candles.get(candleKeyOf(cond)) ?? [],
    evaluation,
    cond.window + 1,
  );
  if (candles.length < cond.window + 1) {
    return { met: false, reason: `need ${cond.window + 1} closed candles`, values: {} };
  }
  const current = candles[candles.length - 1];
  const base = candles[candles.length - 1 - cond.window];
  const movePercent = ((current.close - base.close) / base.close) * 100;
  const values = { move: fmt(movePercent), threshold: fmt(cond.percent) };
  const up = movePercent >= Math.abs(cond.percent);
  const down = movePercent <= -Math.abs(cond.percent);
  const met = cond.direction === "up" ? up : cond.direction === "down" ? down : up || down;
  return {
    met,
    reason: `${movePercent >= 0 ? "+" : ""}${fmt(movePercent)}% move over ${cond.window} bars (threshold ±${fmt(cond.percent)}%)`,
    values,
  };
}

function checkVolumeSpike(
  cond: Extract<AlertCondition, { kind: "volumeSpike" }>,
  evaluation: AlertRule["evaluation"],
  ctx: AlertEngineContext,
): ConditionCheck {
  // The spike bar itself + `lookback` reference bars.
  const candles = usableCandles(
    ctx.candles.get(candleKeyOf(cond)) ?? [],
    evaluation,
    cond.lookback + 1,
  );
  if (candles.length < cond.lookback + 1) {
    return { met: false, reason: `need ${cond.lookback + 1} closed candles`, values: {} };
  }
  const spike = candles[candles.length - 1];
  const prev = candles.slice(-cond.lookback - 1, -1);
  const meanVolume = prev.reduce((s, c) => s + c.volume, 0) / (prev.length > 0 ? prev.length : 1);
  const ratio = meanVolume > 0 ? spike.volume / meanVolume : 0;
  return {
    met: meanVolume > 0 && spike.volume >= meanVolume * cond.multiplier,
    reason: `volume ${fmt(ratio)}× mean of last ${cond.lookback} bars (threshold ${fmt(cond.multiplier)}×)`,
    values: { ratio: fmt(ratio), volume: fmt(spike.volume), meanVolume: fmt(meanVolume) },
  };
}

function checkIndicatorThreshold(
  cond: Extract<AlertCondition, { kind: "indicatorThreshold" }>,
  evaluation: AlertRule["evaluation"],
  ctx: AlertEngineContext,
): ConditionCheck {
  // Indicators tolerate NaN warm-up slots; give generous room past the period.
  const need = cond.period * 5;
  const candles = usableCandles(ctx.candles.get(candleKeyOf(cond)) ?? [], evaluation, need);
  const closes = candles.map((c) => c.close);
  if (closes.length < cond.period) {
    return { met: false, reason: `need ${cond.period} closed candles`, values: {} };
  }
  const last =
    cond.indicator === "rsi"
      ? rsi(closes, cond.period)
      : cond.indicator === "ema"
        ? ema(closes, cond.period)
        : sma(closes, cond.period);
  let value = NaN;
  for (let i = last.length - 1; i >= 0; i--) {
    if (Number.isFinite(last[i])) {
      value = last[i];
      break;
    }
  }
  if (!Number.isFinite(value)) {
    return { met: false, reason: "indicator not computable yet", values: {} };
  }
  const met =
    cond.operator === "<"
      ? value < cond.value
      : cond.operator === ">"
        ? value > cond.value
        : cond.operator === "<="
          ? value <= cond.value
          : value >= cond.value;
  return {
    met,
    reason: `${cond.indicator.toUpperCase()}(${cond.period}) = ${fmt(value)} ${cond.operator} ${fmt(cond.value)}`,
    values: { [cond.indicator]: fmt(value), threshold: fmt(cond.value) },
  };
}

function checkBookImbalance(
  cond: Extract<AlertCondition, { kind: "bookImbalance" }>,
  ctx: AlertEngineContext,
): ConditionCheck {
  const book: OrderBookSnapshot | undefined = ctx.books.get(
    `${cond.exchange}|${cond.type}|${cond.symbol}`,
  );
  if (!book) return { met: false, reason: "no order book snapshot", values: {} };
  const { imbalance } = imbalanceTopN(book.bids, book.asks, cond.topN);
  const met = cond.operator === ">" ? imbalance > cond.threshold : imbalance < cond.threshold;
  return {
    met,
    reason: `book imbalance (top ${cond.topN}) = ${fmt(imbalance, 3)} ${cond.operator} ${fmt(cond.threshold, 3)}`,
    values: { imbalance: fmt(imbalance, 3) },
  };
}

function checkLargeLiquidity(
  cond: Extract<AlertCondition, { kind: "largeLiquidity" }>,
  ctx: AlertEngineContext,
): ConditionCheck {
  const book: OrderBookSnapshot | undefined = ctx.books.get(
    `${cond.exchange}|${cond.type}|${cond.symbol}`,
  );
  if (!book) return { met: false, reason: "no order book snapshot", values: {} };
  const large = findLargeLevels([...book.bids, ...book.asks], { minQuantity: cond.minQuantity });
  const maxQty = large.length > 0 ? large[0].quantity : 0;
  return {
    met: large.length > 0,
    reason:
      large.length > 0
        ? `large resting level of ${fmt(maxQty)} ≥ ${fmt(cond.minQuantity)} visible`
        : `no visible level ≥ ${fmt(cond.minQuantity)}`,
    values: { maxQuantity: fmt(maxQty), minQuantity: fmt(cond.minQuantity) },
  };
}

function checkCondition(
  cond: AlertCondition,
  evaluation: AlertRule["evaluation"],
  ctx: AlertEngineContext,
): ConditionCheck {
  switch (cond.kind) {
    case "priceCross":
      return checkPriceCross(cond, ctx);
    case "percentMove":
      return checkPercentMove(cond, evaluation, ctx);
    case "volumeSpike":
      return checkVolumeSpike(cond, evaluation, ctx);
    case "indicatorThreshold":
      return checkIndicatorThreshold(cond, evaluation, ctx);
    case "bookImbalance":
      return checkBookImbalance(cond, ctx);
    case "largeLiquidity":
      return checkLargeLiquidity(cond, ctx);
  }
}

/** Evaluate one rule. Returns the trigger (or null) and the next engine state. */
export function evaluateAlertRule(
  rule: AlertRule,
  ctx: AlertEngineContext,
  state: AlertEngineState,
): { trigger: AlertTrigger | null; state: AlertEngineState } {
  // Disabled rules are skipped without consuming state.
  if (!rule.enabled || rule.conditions.length === 0) {
    return { trigger: null, state };
  }

  const last = state.lastFiredAt[rule.id];
  if (last != null && ctx.now - last < rule.cooldownMs) {
    // Inside cooldown: suppressed regardless of whether conditions hold.
    return { trigger: null, state };
  }

  const target = rule.conditions[0];
  const targetLabel = `${target.exchange} ${target.type} ${target.symbol}`;

  const checks = rule.conditions.map((c) => checkCondition(c, rule.evaluation, ctx));
  const met = rule.combine === "ALL" ? checks.every((c) => c.met) : checks.some((c) => c.met);
  if (!met) return { trigger: null, state };

  const metChecks = checks.filter((c) => c.met);
  const values = Object.assign({}, ...checks.map((c) => c.values));
  const trigger: AlertTrigger = {
    ruleId: rule.id,
    ruleName: rule.name,
    firedAt: ctx.now,
    values,
    reason: `[${rule.combine}] ${metChecks.map((c) => c.reason).join(" AND ")}`,
  };

  const nextState: AlertEngineState = {
    ...state,
    lastFiredAt: { ...state.lastFiredAt, [rule.id]: ctx.now },
  };
  void targetLabel;
  return { trigger, state: nextState };
}

// ---------------------------------------------------------------------------
// Data-target discovery (used by the live wiring to build the context)
// ---------------------------------------------------------------------------

/** The data an enabled rule set needs for one evaluation pass. */
export interface RuleTargets {
  /** Candle buffer keys, CandleService form: "EX|TYPE|symbol|interval". */
  candleKeys: string[];
  /** Order-book keys, OrderBookService form: "EX|TYPE|symbol". */
  bookKeys: string[];
  /** Last-price keys in EX|TYPE|symbol form (engine-side convention). */
  priceKeys: string[];
}

/**
 * Collect the distinct data targets referenced by the *enabled* conditions of
 * the given rules, so the live wiring subscribes/reads exactly what's needed.
 */
export function collectRuleTargets(rules: AlertRule[]): RuleTargets {
  const candleKeys = new Set<string>();
  const bookKeys = new Set<string>();
  const priceKeys = new Set<string>();

  const bookKinds = new Set(["bookImbalance", "largeLiquidity"]);
  const candleKinds = new Set(["percentMove", "volumeSpike", "indicatorThreshold"]);

  for (const rule of rules) {
    if (!rule.enabled) continue;
    for (const cond of rule.conditions) {
      priceKeys.add(`${cond.exchange}|${cond.type}|${cond.symbol}`);
      if (bookKinds.has(cond.kind)) {
        bookKeys.add(
          orderBookKey(cond.exchange as ExchangeName, cond.type as MarketType, cond.symbol),
        );
      }
      if (candleKinds.has(cond.kind) && "interval" in cond) {
        candleKeys.add(
          candleKey(
            cond.exchange as ExchangeName,
            cond.type as MarketType,
            cond.symbol,
            cond.interval,
          ),
        );
      }
    }
  }
  return { candleKeys: [...candleKeys], bookKeys: [...bookKeys], priceKeys: [...priceKeys] };
}

/** Evaluate a list of rules in order against one context. */
export function evaluateAlertRules(
  rules: AlertRule[],
  ctx: AlertEngineContext,
  state: AlertEngineState,
): { triggers: AlertTrigger[]; state: AlertEngineState } {
  let current = state;
  const triggers: AlertTrigger[] = [];
  for (const rule of rules) {
    const r = evaluateAlertRule(rule, ctx, current);
    current = r.state;
    if (r.trigger) triggers.push(r.trigger);
  }
  return { triggers, state: current };
}
