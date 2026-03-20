import React, { memo } from "react";
import PriceCell from "./PriceCell";

interface Props {
  symbol: string;
  type: string;
  exchanges: string[];
  removeSymbol: (symbol: string) => void;
}

const PriceRow: React.FC<Props> = ({
  symbol,
  type,
  exchanges,
  removeSymbol,
}) => {
  return (
    <tr>
      <td>
        <div className="symbol">
          <span>
            {symbol}-{type}
          </span>
          <button
            className="remove-button"
            onClick={() => removeSymbol(symbol)}
          >
            ✕
          </button>
        </div>
      </td>

      {exchanges.map((exchange) => (
        <td key={exchange}>
          <PriceCell exchange={exchange} symbol={symbol} type={type} />
        </td>
      ))}
    </tr>
  );
};

export default memo(PriceRow);
