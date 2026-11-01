import { memo } from "react";
import type { ExchangeName, MarketType } from "../../types/marketData";

import { formatPrice, formatQty } from "../../utils/priceUtils";
import { useOrderBook } from "../../custom-hooks/useOrderBook";
import { useTrades } from "../../custom-hooks/useTrades";
import { useDataFreshness } from "../../custom-hooks/useDataFreshness";
import styles from "./OrderBookPanel.module.scss";

const ExchangeNames = ["BINANCE", "OKX", "DELTA"] as const;
export const ExchangeNameValues = ExchangeNames;
const MarketTypes = ["SPOT", "FUT"] as const;
export const MarketTypeValues = MarketTypes;

const STALE_AFTER_MS = 10_000;

interface Props {
  exchange: ExchangeNameValues[number];
  symbol: string;
  type: MarketTypeValues[number];
  depthN?: number;
}

const OrderBookPanel: React.FC<Props> = ({ exchange, symbol, type, depthN: depthNProp = 10 }) => {
  const exchangeName = exchange as ExchangeName;
  const typeName = type as MarketType;

  const snap = useOrderBook(exchangeName, symbol, typeName);
  const trades = useTrades(exchangeName, typeName, symbol, 40);
  const { ageMs, fresh } = useDataFreshness(snap.updatedAt, STALE_AFTER_MS);

  const depthN = depthNProp;
  const bids = snap.bids.slice(0, depthN);
  const asks = snap.asks.slice(0, depthN);

  const bbo = {
    isComplete: snap.bestBid != null && snap.bestAsk != null,
    spread: (snap.bestAsk ?? 0) - (snap.bestBid ?? 0),
    spreadPercent: 0,
  };

  // Combined liquidity split: totals per side within +/-1% of mid.
  const bboIsComplete = snap.bestBid != null && snap.bestAsk != null;
  const band =
    snap.totalBidQuantity !== undefined && snap.totalAskQuantity !== undefined
      ? {
          totalBidQuantity: snap.totalBidQuantity,
          totalAskQuantity: snap.totalAskQuantity,
        }
      : { totalBidQuantity: 0, totalAskQuantity: 0 };

  const bandBid = band.totalBidQuantity;
  const bandAsk = band.totalAskQuantity;
  const bandTotal = bandBid + bandAsk;
  const bandBidShare = bandTotal > 0 ? (bandBid / bandTotal) * 100 : 50;

  const verdict = !bboIsComplete
    ? "waiting for depth…"
    : bandBidShare > 55
      ? "Bids heavier — more resting buy liquidity"
      : bandBidShare < 45
        ? "Asks heavier — more resting sell liquidity"
        : "Balanced — neither side dominates";

  const prints = trades.slice().reverse(); // newest first
  const visiblePrints = prints.slice(0, 8);

  // Depth bars: cumulative quantity from mid on each side
  const bidsTotal = bids.reduce((sum, level) => sum + level.b, 0);
  const asksTotal = asks.reduce((sum, level) => sum + level.b, 0);

  const ageText = ageMs == null ? "—" : `${Math.max(0, Math.round(ageMs / 1000))}s`;

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
          <span className={styles.liquidityTitle}>Liquidity split — combined book</span>
          <span className={styles.liquidityVerdict}>{verdict}</span>
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
            Bids {formatQty(bandBid)} · {Math.round(bandBidShare)}%
          </span>
          <span className={styles.splitMid}>±1% of mid · visible depth</span>
          <span className={`${styles.splitLabel} ${styles.askText}`}>
            Asks {formatQty(bandAsk)} · {Math.round(100 - bandBidShare)}%
          </span>
        </div>
      </div>

      <div className={styles.depthSection}>
        {bids.length === 0 && asks.length === 0 ? (
          <div className={styles.emptyDepth}>No depth data yet</div>
        ) : (
          <>
            <div className={styles.sideCol}>
              <div className={styles.sideHead}>
                <span className={styles.sideTitle}>Asks</span>
                <span className={styles.sideTotal}>{formatQty(snap.asksTotal ?? 0)}</span>
              </div>
              <div className={styles.colLabels}>
                <span>Total</span>
                <span>Size</span>
                <span>Price</span>
              </div>{" "}
              {asks.map((l) => (
                <div
                  key={`a-${l.price}`}
                  className={styles.levelRow}
                  style={{
                    backgroundColor: l.c === "added" ? "rgba(23, 163, 74, 0.3)" : "",
                  }}
                >
                  <span className={styles.levelCum}>{formatQty(l.price)}</span>
                  <span className={styles.levelQty}>{formatQty(l.b)}</span>
                  <span className={styles.levelPrice}>{formatPrice(l.price)}</span>
                  <div
                    className={styles.depthBar}
                    style={{
                      left: "50%",
                      width: Math.max(1, (l.b / Math.max(asksTotal, 1)) * 100) + "%",
                    }}
                  />
                </div>
              ))}
            </div>

            <div className={styles.centerCol}>
              <div className={styles.midBox}>
                <span className={styles.midLabel}>Mid</span>
                <span className={styles.midPrice}>
                  {snap.midPrice != null ? formatPrice(snap.midPrice) : "—"}
                </span>
                <span className={styles.midSpread}>
                  {bbo.isComplete ? formatPrice(bbo.spread) : "—"}
                </span>
              </div>
            </div>

            <div className={styles.sideCol}>
              <div className={styles.sideHead}>
                <span className={styles.sideTitle}>Bids</span>
                <span className={styles.sideTotal}>{formatQty(snap.bidsTotal ?? 0)}</span>
              </div>
              <div className={styles.colLabels}>
                <span>Price</span>
                <span>Size</span>
                <span>Total</span>
              </div>{" "}
              {bids.map((l) => (
                <div
                  key={`b-${l.price}`}
                  className={styles.levelRow}
                  style={{
                    backgroundColor: l.c === "added" ? "rgba(23, 163, 74, 0.3)" : "",
                  }}
                >
                  <span className={styles.levelPrice}>{formatPrice(l.price)}</span>
                  <span className={styles.levelQty}>{formatQty(l.b)}</span>
                  <span className={styles.levelCum}>{formatQty(l.price)}</span>
                  <div
                    className={styles.depthBar}
                    style={{
                      left: "50%",
                      width: Math.max(1, (l.b / Math.max(bidsTotal, 1)) * 100) + "%",
                    }}
                  />
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {trades.length > 0 && (
        <div className={styles.printsSection}>
          <div className={styles.sectionTitle}>Large prints</div>
          {visiblePrints.map((t: NonNullable<Awaited<ReturnType<typeof trades>>[number]>) => (
            <div key={t.id} className={styles.printRow}>
              <span className={styles.printTime}>{new Date(t.timeStamp).toLocaleTimeString()}</span>
              <span className={styles.printQty}> {formatQty(t.b)} </span>
              <span className={styles.printPrice}> @ {formatPrice(t.price)} </span>
              <span className={styles.printSide}>{t.buyerMaker ? "sell" : "buy"}</span>
            </div>
          ))}
        </div>
      )}

      <p className={styles.disclaimer}>
        Visible resting liquidity only — large resting orders can be spoofed or cancelled.
      </p>
      <span className={styles.disclaimerNote}>
        Binance publishes aggregate trade prints; OKX/Delta trade sources are not yet.
      </span>
    </div>
  );
};

export default memo(OrderBookPanel);
