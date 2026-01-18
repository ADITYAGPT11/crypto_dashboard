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
          <div className="symbol-icon">
            {symbol.charAt(0).toUpperCase()}
          </div>
          {symbol}
          <button className="remove-button" onClick={() => removeSymbol(symbol)}>✕</button>
        </div>
      </td>

      <td>
        <span className="type">{type}</span>
      </td>

      {exchanges.map((exchange) => (
        <td key={exchange}>
          <PriceCell
            exchange={exchange}
            symbol={symbol}
            type={type}
          />
        </td>
      ))}

      <td>—</td>
    </tr>
  );
};

export default memo(PriceRow);
