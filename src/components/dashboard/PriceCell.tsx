import { memo } from "react";
import { useLivePrice } from "../../custom-hooks/useLivePrice";
import { useDataFreshness } from "../../custom-hooks/useDataFreshness";
import { useLiveFundingRate } from "../../custom-hooks/useLiveFundingRate";
import { useTickerStats } from "../../custom-hooks/useTickerStats";
import { formatCompactQty, formatSignedPercent } from "../../utils/priceUtils";
import type { ExchangeName, MarketType } from "../../types/marketData";

interface Props {
  exchange: string;
  symbol: string;
  type: string;
}

/** After this many ms without a tick on this exact feed, the cell is flagged stale. */
const STALE_AFTER_MS = 6_000;

function formatFundingTime(ts: number | null): string {
  if (!ts) return "";
  const remaining = ts - Date.now();
  if (remaining <= 0) return "Now";
  const hours = Math.floor(remaining / 3600000);
  const mins = Math.floor((remaining % 3600000) / 60000);
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function formatInterval(sec: number | undefined): string {
  if (!sec) return "";
  const hours = sec / 3600;
  if (hours >= 1 && hours === Math.floor(hours)) return `${hours}h`;
  return `${sec}s`;
}

function formatAge(ageMs: number | null): string {
  if (ageMs == null) return "never updated";
  if (ageMs < 1_000) return "updated just now";
  return `updated ${Math.floor(ageMs / 1_000)}s ago`;
}

const PriceCell: React.FC<Props> = ({ exchange, symbol, type }) => {
  const { price, updatedAt } = useLivePrice(exchange, symbol, type);
  const freshness = useDataFreshness(updatedAt, STALE_AFTER_MS);
  const fr = useLiveFundingRate(exchange, symbol);
  // 24h rollups (change%, base volume) — polled REST, not real-time.
  const stats = useTickerStats(exchange as ExchangeName, symbol, type as MarketType);
  const isFut = type === "FUT";

  return (
    <div className="price-cell">
      <span className="price">
        {price != null
          ? price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
          : "-"}
        {freshness.hasData && (
          <span
            className={`freshness-badge ${freshness.fresh ? "badge-fresh" : "badge-stale"}`}
            title={`${exchange} ${type}: ${formatAge(freshness.ageMs)}${
              freshness.fresh ? "" : " — data may be stale"
            }`}
            aria-label={freshness.fresh ? "data fresh" : "data stale"}
          />
        )}
      </span>
      {stats && (stats.changePercent != null || stats.volumeBase != null) && (
        <span
          className="ticker-stats"
          title="24h change and base-asset volume from the exchange REST ticker, refreshed every 60s (not real-time)"
        >
          <span
            className={`chg ${
              (stats.changePercent ?? 0) > 0
                ? "positive"
                : (stats.changePercent ?? 0) < 0
                  ? "negative"
                  : "neutral"
            }`}
          >
            {formatSignedPercent(stats.changePercent)}
          </span>
          <span className="stat-sep">|</span>
          <span className="vol">Vol {formatCompactQty(stats.volumeBase)}</span>
        </span>
      )}
      {isFut && fr && (
        <span className={`funding-info ${fr.rate >= 0 ? "positive" : "negative"}`}>
          <span className="fr-rate">{fr.rate.toFixed(6)}%</span>
          {fr.fundingInterval != null && (
            <>
              <span className="fr-sep">|</span>
              <span className="fr-interval">{formatInterval(fr.fundingInterval)}</span>
            </>
          )}
          <span className="fr-sep">|</span>
          <span className="fr-next">{formatFundingTime(fr.nextFundingTime)}</span>
        </span>
      )}
    </div>
  );
};

export default memo(PriceCell);
