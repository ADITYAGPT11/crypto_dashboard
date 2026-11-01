import React, { memo } from "react";
import "./PriceTable.scss";
import PriceRow from "./PriceRow";

interface PriceTableProps {
  symbols: string[];
  types: string[];
  exchanges: string[];
  removeSymbol: (symbol: string) => void;
}

const PriceTable: React.FC<PriceTableProps> = ({ symbols, types, exchanges, removeSymbol }) => {
  return (
    <div className="table-container">
      <table className="table">
        <thead>
          <tr>
            <th>Asset</th>
            {exchanges.map((exchange) => (
              <th key={exchange}>{exchange}</th>
            ))}
          </tr>
        </thead>

        <tbody>
          {symbols.map((symbol) =>
            types.map((type) => (
              <PriceRow
                key={`${symbol}-${type}`}
                symbol={symbol}
                type={type}
                exchanges={exchanges}
                removeSymbol={removeSymbol}
              />
            )),
          )}
        </tbody>
      </table>
    </div>
  );
};

export default memo(PriceTable);
