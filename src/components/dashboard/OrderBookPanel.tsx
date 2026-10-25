import React, { memo } from "react";
import type { ExchangeName, MarketType } from "../../types/marketData";
import { formatPrice, formatQty } from "../../utils/priceUtils";
import { useOrderBook } from "../../custom-hooks/useOrderBook";
import { useDataFreshness } from "../../custom-hooks/useDataFreshness";
import styles from "./OrderBookPanel.module.scss";

interface Props {
  exchange: string;
  symbol: string;
  type: string;
  depthN?: number;
}

const ExchangeNames = ["BINANCE", "OKX", "DELTA"] as const;
const MarketTypes = ["SPOT", "FUT"] as const;

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

const OrderBookPanel: React.FC<Props> = ({ exchange, symbol, type, depthN = 10 }) => {
  const snap = useOrderBook(toExchangeName(exchange), symbol, toMarketType(type));
  // One 1 Hz tick keeps the "updated Xs ago" label live without impure renders.
  const { ageMs } = useDataFreshness(snap?.updatedAt ?? null, Number.MAX_SAFE_INTEGER);

  const bids = snap?.bids.slice(0, depthN) ?? [];
  const asks = snap?.asks.slice(0, depthN) ?? [];
  const bestBid = snap?.bestBid;
  const bestAsk = snap?.bestAsk;
  const bestBidQty = snap?.bestBidQty ?? 0;
  const bestAskQty = snap?.bestAskQty ?? 0;
  const midPrice = snap?.midPrice;

  // Row ladder recomputed per publish — cheap; no value memoizing an array
  // that is freshly sliced from the service snapshot each event.
  const rows = (() => {
    const out: Array<{ price: number; qty: number; cumulative: number; side: "bid" | "ask" }> = [];
    let bidCum = 0;
    const bidSlice = bids.slice().reverse(); // lowest price first (closest to mid)
    for (let i = Math.min(bidSlice.length, depthN); i > 0; i--) {
      const l = bidSlice[i - 1];
      bidCum += l.quantity;
      out.push({
        price: l.price,
        qty: l.quantity,
        cumulative: bidCum,
        side: "bid",
      });
    }
    let askCum = 0;
    for (let i = 0; i < Math.min(asks.length, depthN); i++) {
      const l = asks[i];
      askCum += l.quantity;
      out.push({
        price: l.price,
        qty: l.quantity,
        cumulative: askCum,
        side: "ask",
      });
    }
    return out;
  })();

  const ageText = ageMs == null ? "—" : `${Math.max(0, Math.round(ageMs / 1000))}s`;

  return (
    <div className={styles.wrapper}>
      <div className={styles.title}>
        <span>
          {exchange} · {symbol}
        </span>
        {midPrice != null ? (
          <span className={styles.mid}>mid {formatPrice(midPrice)}</span>
        ) : (
          <span className={styles.mid}>mid —</span>
        )}
      </div>

      <div className={styles.topRow}>
        <div className={styles.col}>
          <span className={styles.colLabel}>Bid</span>
          {bestBid != null ? (
            <span className={styles.price}>{formatPrice(bestBid)}</span>
          ) : (
            <span className={styles.price}>—</span>
          )}
          <span className={styles.muted}>{formatQty(bestBidQty)}</span>
        </div>
        <div className={styles.col}>
          <span className={styles.colLabel}>Ask</span>
          {bestAsk != null ? (
            <span className={styles.price}>{formatPrice(bestAsk)}</span>
          ) : (
            <span className={styles.price}>—</span>
          )}
          <span className={styles.muted}>{formatQty(bestAskQty)}</span>
        </div>
        <div className={styles.col}>
          <span className={styles.colLabel}>Updated</span>
          <span className={styles.muted}>{ageText}</span>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className={styles.empty}>No depth data yet</div>
      ) : (
        <div className={styles.book}>
          {rows.map((r, i) => (
            <div
              key={`${r.side}-${i}`}
              className={`${styles.row} ${r.side === "bid" ? styles.bid : styles.ask}`}
            >
              <span className={styles.price}>{formatPrice(r.price)}</span>
              <span className={styles.muted}>{formatQty(r.qty)}</span>
              <span className={styles.cumulative}>{formatQty(r.cumulative)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default memo(OrderBookPanel);
