import { useEffect, useRef, useState, memo } from "react";
import type { ExchangeName, MarketType, OrderBookSnapshot } from "../../types/marketData";
import { formatPrice, formatQty } from "../../utils/priceUtils";
import { useOrderBook } from "../../custom-hooks/useOrderBook";
import { useTrades } from "../../custom-hooks/useTrades";
import { useDataFreshness } from "../../custom-hooks/useDataFreshness";
import {
  aggregateDepthByDistance,
  churnMapByPrice,
  diffDepthByLevel,
  findLargePrints,
  findLargeLevels,
  imbalanceTopN,
  snapshotBboMetrics,
} from "../../utils/orderBookUtils";
import styles from "./OrderBookPanel.module.scss";

interface Props {
  exchange: string;
  symbol: string;
  type: string;
  depthN?: number;
}

const ExchangeNames = ["BINANCE", "OKX", "DELTA"] as const;
const MarketTypes = ["SPOT", "FUT"] as const;

/** A depth feed older than this is stale even though Binance publishes at 100ms cadence. */
const STALE_AFTER_MS = 10_000;

function toExchangeName(s: string): ExchangeName {
  if ((ExchangeNames as readonly string[]).includes(s)) {
    return s as unknown as ExchangeName;
  }
  throw new Error(`Unknown exchange: ${s}`);
}

function toMarketType(s: string): MarketType {
  if ((MarketTypes as readonly string[]).includes(s)) {
    return s as unknown as MarketType;
  }
  throw new Error(`Unknown market type: ${s}`);
}

function clampNumber(raw: string, fallback: number, min: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function formatClock(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function churnCells(
  churn: Map<string, number>,
  side: "bid" | "ask",
  price: number,
  addedClass: string,
  removedClass: string,
): { mark: string; className: string } {
  const delta = churn.get(`${side}|${price}`);
  if (delta == null || delta === 0) return { mark: "", className: "" };
  return delta > 0
    ? { mark: " \u25B2", className: addedClass }
    : { mark: " \u25BC", className: removedClass };
}

const OrderBookPanel: React.FC<Props> = ({ exchange, symbol, type, depthN: depthNProp = 10 }) => {
  const exchangeName = toExchangeName(exchange);
  const typeName = toMarketType(type);

  // Aggregation settings (Module 5: "data freshness + aggregation settings").
  const [depthN, setDepthN] = useState(depthNProp);
  const [imbaTopN, setImbaTopN] = useState(10);
  const [largeOrderQty, setLargeOrderQty] = useState(1);
  const [largePrintQty, setLargePrintQty] = useState(5);

  const snap = useOrderBook(exchangeName, symbol, typeName);
  const trades = useTrades(exchangeName, typeName, symbol, 40);
  const { ageMs, fresh } = useDataFreshness(snap.updatedAt, STALE_AFTER_MS);

  // Churn vs the previously committed snapshot. The ref is only read inside
  // the effect (not during render) and churn lives in state, so the React
  // compiler stays happy and the render stays pure.
  const prevRef = useRef<OrderBookSnapshot | null>(null);
  const [churn, setChurn] = useState<Map<string, number>>(new Map());
  // Runs after EVERY render on purpose: the snapshot instance changes each
  // service publish, and setChurn is only called when real deltas exist, so
  // the update chain terminates after one extra render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const baseline = prevRef.current;
    prevRef.current = snap;
    if (!baseline) return;
    const diff = diffDepthByLevel(baseline, snap);
    if (diff.deltas.length > 0) {
      setChurn(churnMapByPrice(diff.deltas));
    }
  });

  const bids = snap.bids.slice(0, depthN);
  const asks = snap.asks.slice(0, depthN);
  const largeBidPrices = new Set(
    findLargeLevels(bids, { minQuantity: largeOrderQty }).map((l) => l.price),
  );
  const largeAskPrices = new Set(
    findLargeLevels(asks, { minQuantity: largeOrderQty }).map((l) => l.price),
  );

  const bbo = snapshotBboMetrics(snap);
  const imba = imbalanceTopN(snap.bids, snap.asks, imbaTopN);
  // Combined-book liquidity split: totals per side within ±1% of mid.
  // This answers "which side has more liquidity" and the same numbers feed
  // the heatmap overlay's intensity normalization.
  const band = aggregateDepthByDistance(snap);
  const bandBid = band.totalBidQuantity;
  const bandAsk = band.totalAskQuantity;
  const bandTotal = bandBid + bandAsk;
  const bandBidShare = bandTotal > 0 ? (bandBid / bandTotal) * 100 : 50;
  const verdict = !band.isComplete
    ? "waiting for depth\u2026"
    : bandBidShare > 55
      ? "Bids heavier — more resting buy liquidity"
      : bandBidShare < 45
        ? "Asks heavier — more resting sell liquidity"
        : "Balanced — neither side dominates";

  const prints = findLargePrints(trades, largePrintQty).slice().reverse(); // newest first
  const visiblePrints = prints.slice(0, 8);

  // Depth bars: cumulative quantity from mid on each side, scaled by the
  // deeper side (classic TradingView-style horizontal depth bars).
  const maxCum = Math.max(
    bids.reduce((s, l) => s + l.quantity, 0),
    asks.reduce((s, l) => s + l.quantity, 0),
  );
  const bidsTotal = bids.reduce((s, l) => s + l.quantity, 0);
  const asksTotal = asks.reduce((s, l) => s + l.quantity, 0);

  const reads = Math.max(1, Math.min(20, imbaTopN));
  const ageText = ageMs == null ? "—" : `${Math.max(0, Math.round(ageMs / 1000))}s`;

  // Commit this snapshot as the next diff's baseline (after render, render stays pure).
  useEffect(() => {
    prevRef.current = snap;
  });

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span className={styles.title}>
          {exchange} · {symbol}
        </span>
        <span className={styles.timestamp}>
          {ageText} · {fresh ? "fresh" : "stale"}
        </span>
      </div>

      <div className={styles.bboRow}>
        <div className={`${styles.bboCell} ${styles.bidCell}`}>
          <span className={styles.label}>Bid</span>
          <span className={styles.price}>
            {snap.bestBid != null ? formatPrice(snap.bestBid) : "—"}
          </span>
          <span className={styles.muted}>{formatQty(snap.bestBidQty ?? 0)}</span>
        </div>
        <div className={styles.spreadCell}>
          <span className={styles.label}>Spread</span>
          <span className={styles.spreadValue}>
            {bbo.isComplete ? formatPrice(bbo.spread) : "—"}
          </span>
          <span className={styles.muted}>
            {bbo.isComplete ? `${bbo.spreadPercent.toFixed(3)}%` : ""}
          </span>
        </div>
        <div className={`${styles.bboCell} ${styles.askCell}`}>
          <span className={styles.label}>Ask</span>
          <span className={styles.price}>
            {snap.bestAsk != null ? formatPrice(snap.bestAsk) : "—"}
          </span>
          <span className={styles.muted}>{formatQty(snap.bestAskQty ?? 0)}</span>
        </div>
      </div>

      <div className={styles.liquidityBlock}>
        <div className={styles.liquidityHead}>
          <span className={styles.sectionTitle}>Liquidity split — combined book</span>
          <span
            className={`${styles.liquidityVerdict} ${
              !band.isComplete
                ? ""
                : bandBidShare > 55
                  ? styles.verdictBid
                  : bandBidShare < 45
                    ? styles.verdictAsk
                    : ""
            }`}
          >
            {verdict}
          </span>
        </div>
        <div className={styles.splitBar} title="Visible depth within ±1% of mid">
          <div className={styles.splitBid} style={{ width: `${bandBidShare.toFixed(1)}%` }} />
          <div
            className={styles.splitAsk}
            style={{ width: `${(100 - bandBidShare).toFixed(1)}%` }}
          />
        </div>
        <div className={styles.splitLabels}>
          <span className={`${styles.splitLabel} ${styles.bidText}`}>
            Bids {formatQty(bandBid)} \u00B7 {Math.round(bandBidShare)}%
          </span>
          <span className={styles.splitMid}>±1% of mid · visible depth</span>
          <span className={`${styles.splitLabel} ${styles.askText}`}>
            Asks {formatQty(bandAsk)} \u00B7 {Math.round(100 - bandBidShare)}%
          </span>
        </div>
        <div className={styles.liquidityNote}>
          Top-{reads} imbalance: {imba.imbalance >= 0 ? "+" : ""}
          {imba.imbalance.toFixed(2)} ({imba.imbalance >= 0 ? "bids" : "asks"} dominate)
        </div>
      </div>

      <div className={styles.settingsRow}>
        <label className={styles.setting}>
          Depth
          <input
            type="number"
            min={3}
            max={20}
            value={depthN}
            onChange={(e) => setDepthN(clampNumber(e.target.value, depthN, 3, 20))}
          />
        </label>
        <label className={styles.setting}>
          Imbalance top N
          <input
            type="number"
            min={1}
            max={20}
            value={imbaTopN}
            onChange={(e) => setImbaTopN(clampNumber(e.target.value, imbaTopN, 1, 20))}
          />
        </label>
        <label className={styles.setting}>
          Large order ≥
          <input
            type="number"
            min={0}
            step={0.1}
            value={largeOrderQty}
            onChange={(e) => setLargeOrderQty(clampNumber(e.target.value, largeOrderQty, 0, 1e9))}
          />
        </label>
        <label className={styles.setting}>
          Large print ≥
          <input
            type="number"
            min={0}
            step={0.1}
            value={largePrintQty}
            onChange={(e) => setLargePrintQty(clampNumber(e.target.value, largePrintQty, 0, 1e9))}
          />
        </label>
      </div>

      <div className={styles.depthSection}>
        {bids.length === 0 && asks.length === 0 ? (
          <div className={styles.emptyDepth}>No depth data yet</div>
        ) : (
          <>
            {/* ASKS (left): best ask at the top row, deepest at the bottom;
                depth bars grow from the center edge leftward. */}
            <div className={styles.sideCol}>
              <div className={styles.sideHead}>
                <span className={styles.sideTitle}>Asks — sell orders</span>
                <span className={styles.sideTotal}>{formatQty(asksTotal)}</span>
              </div>
              <div className={styles.colLabels}>
                <span>Total</span>
                <span>Size</span>
                <span>Price</span>
              </div>
              {asks.map((l, idx, arr) => {
                const cum = arr.slice(0, idx + 1).reduce((s, e) => s + e.quantity, 0);
                const c = churnCells(churn, "ask", l.price, styles.addedLevel, styles.removedLevel);
                return (
                  <div
                    key={`a-${l.price}`}
                    className={`${styles.levelRow} ${largeAskPrices.has(l.price) ? styles.largeRow : ""}`}
                  >
                    <span className={styles.levelCum}>{formatQty(cum)}</span>
                    <span className={`${styles.levelQty} ${c.className}`}>
                      {formatQty(l.quantity)}
                      {c.mark}
                    </span>
                    <span className={styles.levelPrice}>{formatPrice(l.price)}</span>
                    <span
                      className={`${styles.depthBar} ${styles.barFromCenter}`}
                      style={{
                        width: `${maxCum > 0 ? ((cum / maxCum) * 100).toFixed(1) : 0}%`,
                      }}
                    />
                  </div>
                );
              })}
            </div>

            {/* CENTER: mid price + spread between the two ladders. */}
            <div className={styles.centerCol}>
              <div className={styles.midBox}>
                <span className={styles.midLabel}>Mid</span>
                <span className={styles.midPrice}>
                  {snap.midPrice != null ? formatPrice(snap.midPrice) : "—"}
                </span>
                <span className={styles.midSpread}>
                  {bbo.isComplete ? formatPrice(bbo.spread) : "—"}
                </span>
                <span className={styles.midSpreadPct}>
                  {bbo.isComplete ? `${bbo.spreadPercent.toFixed(3)}%` : ""}
                </span>
              </div>
            </div>

            {/* BIDS (right): best bid at the top row, deepest at the bottom;
                depth bars grow from the center edge rightward. */}
            <div className={styles.sideCol}>
              <div className={styles.sideHead}>
                <span className={styles.sideTitle}>Bids — buy orders</span>
                <span className={styles.sideTotal}>{formatQty(bidsTotal)}</span>
              </div>
              <div className={styles.colLabels}>
                <span>Price</span>
                <span>Size</span>
                <span>Total</span>
              </div>
              {bids.map((l, idx, arr) => {
                const cum = arr.slice(0, idx + 1).reduce((s, e) => s + e.quantity, 0);
                const c = churnCells(churn, "bid", l.price, styles.addedLevel, styles.removedLevel);
                return (
                  <div
                    key={`b-${l.price}`}
                    className={`${styles.levelRow} ${largeBidPrices.has(l.price) ? styles.largeRow : ""}`}
                  >
                    <span className={styles.levelPrice}>{formatPrice(l.price)}</span>
                    <span className={`${styles.levelQty} ${c.className}`}>
                      {formatQty(l.quantity)}
                      {c.mark}
                    </span>
                    <span className={styles.levelCum}>{formatQty(cum)}</span>
                    <span
                      className={`${styles.depthBar} ${styles.barFromCenterLeft}`}
                      style={{
                        width: `${maxCum > 0 ? ((cum / maxCum) * 100).toFixed(1) : 0}%`,
                      }}
                    />
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {visiblePrints.length > 0 && (
        <div className={styles.printsSection}>
          <div className={styles.sectionTitle}>Large prints (≥ {formatQty(largePrintQty)})</div>
          {visiblePrints.map((t, i) => (
            <div key={i} className={styles.printRow}>
              <span className={styles.printTime}>{formatClock(t.timeStamp)}</span>
              <span
                className={`${styles.printQty} ${t.buyerMaker ? styles.printSell : styles.printBuy}`}
              >
                {formatQty(t.quantity)}
              </span>
              <span className={styles.printPrice}>@ {formatPrice(t.price)}</span>
              <span className={styles.printSide}>{t.buyerMaker ? "sell" : "buy"}</span>
            </div>
          ))}
        </div>
      )}

      <p className={styles.disclaimer}>
        Visible resting liquidity only — the public feed cannot identify order owners, and large
        resting orders can be spoofed or cancelled. &ldquo;Reduced&rdquo; churn mixes fills, edits
        and cancellations, which are indistinguishable without order IDs.
      </p>
      <span className={styles.disclaimerNote}>
        Binance publishes aggregate trade prints; OKX/Delta trade sources are not wired yet.
      </span>
    </div>
  );
};

export default memo(OrderBookPanel);
