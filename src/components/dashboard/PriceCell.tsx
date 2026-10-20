import { memo } from "react";
import { useLivePrice } from "../../custom-hooks/useLivePrice";
import { useLiveFundingRate } from "../../custom-hooks/useLiveFundingRate";

interface Props {
  exchange: string;
  symbol: string;
  type: string;
}

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

const PriceCell: React.FC<Props> = ({ exchange, symbol, type }) => {
  const price = useLivePrice(exchange, symbol, type);
  const fr = useLiveFundingRate(exchange, symbol);
  const isFut = type === "FUT";

  return (
    <div className="price-cell">
      <span className="price">
        {price != null
          ? price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
          : "-"}
      </span>
      {isFut && fr && (
        <span className={`funding-info ${fr.rate >= 0 ? "positive" : "negative"}`}>
          <span className="fr-rate">{(fr.rate).toFixed(6)}%</span>
          {fr.fundingInterval != null && <><span className="fr-sep">|</span><span className="fr-interval">{formatInterval(fr.fundingInterval)}</span></>}
          <span className="fr-sep">|</span>
          <span className="fr-next">{formatFundingTime(fr.nextFundingTime)}</span>
        </span>
      )}
    </div>
  );
};

export default memo(PriceCell);
