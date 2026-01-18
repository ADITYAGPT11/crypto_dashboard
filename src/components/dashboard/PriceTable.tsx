import React, { memo } from "react";
import "./PriceTable.scss";
import PriceRow from "./PriceRow";

interface PriceTableProps {
  symbols: string[];
  types: string[];
  exchanges: string[];
  hasData: boolean;
  removeSymbol: (symbol: string) => void;
}

const PriceTable: React.FC<PriceTableProps> = ({
  symbols,
  types,
  exchanges,
  hasData,
  removeSymbol,
}) => {
  return (
    <div className="table-container">
      <table className="table">
        <thead>
          <tr>
            <th>Asset</th>
            <th>Market</th>

            {exchanges.length > 0 ? (
              exchanges.map((ex) => <th key={ex}>{ex} Price</th>)
            ) : (
              <>
                <th>Binance Price</th>
                <th>OKX Price</th>
              </>
            )}

            <th>Spread</th>
          </tr>
        </thead>

        <tbody>
          {hasData ? (
            symbols.map((symbol) =>
              types.map((type) => (
                <PriceRow
                  key={`${symbol}-${type}`}
                  symbol={symbol}
                  type={type}
                  exchanges={exchanges}
                  removeSymbol={removeSymbol}
                />
              ))
            )
          ) : (
            // Skeleton rows
            symbols.map((symbol) =>
              ["SPOT", "FUT"].map((type) => (
                <tr key={`${symbol}-${type}`}>
                  <td>
                    <div className="symbol">
                      <div className="symbol-icon">
                        {symbol.charAt(0).toUpperCase()}
                      </div>
                      {symbol}
                    </div>
                  </td>
                  <td>
                    <span className="type">{type}</span>
                  </td>

                  <td>
                    <div className="skeleton"></div>
                  </td>
                  <td>
                    <div className="skeleton"></div>
                  </td>

                  <td>
                    <div className="skeleton"></div>
                  </td>
                </tr>
              ))
            )
          )}
        </tbody>
      </table>
    </div>
  );
};

export default memo(PriceTable);
