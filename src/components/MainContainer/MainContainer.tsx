import { useEffect, useState, useRef, useCallback, memo } from "react";
import { MarketDataService } from "../../services/MarketDataService";
import type { ArbitrageOpportunity } from "../../types/marketData";
import type { ConnectionState } from "../../types/connection";

import ArbitragePanel from "../ArbitragePanel/ArbitragePanel";
import ChartPanel from "../ChartPanel/ChartPanel";
import Metrics from "../dashboard/Metrics";
import PriceTable from "../dashboard/PriceTable";
import ConnectionStatus from "../dashboard/ConnectionStatus";
import styles from "./MainContainer.module.scss";
import SymbolSearch from "../../common-components/SymbolSearch";
import { loadWatchlist, saveWatchlist } from "../../utils/watchlistStorage";
import OrderBookPanel from "../dashboard/OrderBookPanel";
import AlertsPanel from "../AlertsPanel/AlertsPanel";
import {
  loadPanelLayout,
  savePanelLayout,
  type PanelEntry,
  type PanelId,
} from "../../utils/layoutStorage";

const PANEL_LABELS: Record<PanelId, string> = {
  metrics: "Market summary",
  connectionStatus: "Connection status",
  chart: "Chart",
  priceTable: "Price table",
  arbitrage: "Spread panel",
  orderBook: "Order book",
  alerts: "Alerts",
};

const EXCHANGES = ["BINANCE", "DELTA", "OKX"];
const TYPES = ["SPOT", "FUT"];

const MainContainer: React.FC = () => {
  const marketDataService = useRef<MarketDataService | null>(null);

  // Persisted watchlist: seed from localStorage and save on every change (Module 3).
  const [symbolList, setSymbolList] = useState<string[]>(() => loadWatchlist());

  // Persisted widget layout: order + visibility per panel (Module 3 customization).
  const [panelLayout, setPanelLayout] = useState<PanelEntry[]>(() => loadPanelLayout());
  const [customizeMode, setCustomizeMode] = useState(false);

  const [arbitrageOpportunities, setArbitrageOpportunities] = useState<ArbitrageOpportunity[]>([]);

  const [connectionStatuses, setConnectionStatuses] = useState<Record<string, ConnectionState>>({
    BINANCE: "connecting",
    DELTA: "connecting",
    OKX: "connecting",
  });

  // const ARBITRAGE_THRESHOLD_PERCENT = 0.1;

  const addSymbol = useCallback((symbol: string) => {
    setSymbolList((prev) => (prev.includes(symbol) ? prev : [...prev, symbol]));
  }, []);

  const removeSymbol = useCallback((symbol: string) => {
    setSymbolList((prev) => prev.filter((s) => s !== symbol));
    // Stop the arbitrage engine tracking it and drop any stale spread row.
    marketDataService.current?.removeSymbol(symbol);
    setArbitrageOpportunities((prev) => prev.filter((o) => o.symbol !== symbol));
  }, []);

  useEffect(() => {
    if (!marketDataService.current) {
      marketDataService.current = MarketDataService.getInstance();
    }

    const service = marketDataService.current;

    const arbHandler = (opportunity: ArbitrageOpportunity) => {
      setArbitrageOpportunities((prev) => {
        const idx = prev.findIndex((o) => o.symbol === opportunity.symbol);
        if (idx !== -1) {
          const copy = [...prev];
          copy[idx] = opportunity;
          return copy;
        }
        return [...prev, opportunity];
      });
    };

    service.on("arbitrage", arbHandler);

    const statusHandler = (s: { exchange: string; state: ConnectionState }) => {
      setConnectionStatuses((prev) =>
        prev[s.exchange] === s.state ? prev : { ...prev, [s.exchange]: s.state },
      );
    };
    service.on("connectionStatus", statusHandler);

    return () => {
      service.off("arbitrage", arbHandler);
      service.off("connectionStatus", statusHandler);
    };
  }, []);

  useEffect(() => {
    saveWatchlist(symbolList);
  }, [symbolList]);

  useEffect(() => {
    savePanelLayout(panelLayout);
  }, [panelLayout]);

  useEffect(() => {
    if (marketDataService.current && symbolList.length > 0) {
      marketDataService.current.startMarketData(symbolList);
    }
  }, [symbolList]);

  const movePanel = useCallback((id: PanelId, direction: -1 | 1) => {
    setPanelLayout((prev) => {
      const idx = prev.findIndex((e) => e.id === id);
      const target = idx + direction;
      if (idx === -1 || target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  }, []);

  const togglePanelVisibility = useCallback((id: PanelId) => {
    setPanelLayout((prev) =>
      // Hidden panels stay in the layout (order preserved), just marked invisible.
      prev.map((e) => (e.id === id ? { ...e, visible: !e.visible } : e)),
    );
  }, []);

  const renderPanel = useCallback(
    (panelId: PanelId) => {
      switch (panelId) {
        case "metrics":
          return (
            <Metrics
              key={panelId}
              totalSymbols={symbolList.length}
              totalExchanges={EXCHANGES.length}
              totalDataPoints={symbolList.length * EXCHANGES.length * TYPES.length}
            />
          );
        case "connectionStatus":
          return <ConnectionStatus key={panelId} statuses={connectionStatuses} />;
        case "chart":
          return (
            <ChartPanel
              key={panelId}
              symbol={symbolList[0] ?? "BTC-USDT"}
              intervals={CANDLE_INTERVALS}
              setInterval={setActiveInterval}
            />
          );
        case "priceTable":
          return (
            <PriceTable
              key={panelId}
              symbols={symbolList}
              types={TYPES}
              exchanges={EXCHANGES}
              hasData={true}
              removeSymbol={removeSymbol}
            />
          );
        case "arbitrage":
          return <ArbitragePanel key={panelId} opportunities={arbitrageOpportunities} />;
        case "orderBook":
          // Module 5 (order book): first tracked symbol on Binance spot — single source.
          if (symbolList.length > 0) {
            return (
              <OrderBookPanel key={panelId} exchange="BINANCE" symbol={symbolList[0]} type="SPOT" />
            );
          }
          return null;
        case "alerts":
          // Module 6 (alert rules): rule builder + trigger log, own evaluation timer.
          return <AlertsPanel key={panelId} symbols={symbolList} />;
      }
    },
    [symbolList, connectionStatuses, arbitrageOpportunities, removeSymbol],
  );

  return (
    <div className={styles.dashboard}>
      <div className={styles.container}>
        <div className={styles.searchContainer}>
          <SymbolSearch onAddSymbol={addSymbol} currentSymbols={symbolList} />
        </div>

        {/* Module 3 widget customization: reorder + hide/show, persisted per browser. */}
        <div className={styles.customizeRow}>
          <button
            type="button"
            className={styles.customizeToggle}
            onClick={() => setCustomizeMode((v) => !v)}
            aria-expanded={customizeMode}
          >
            {customizeMode ? "Close layout editor" : "Edit layout"}
          </button>
          {customizeMode && (
            <div className={styles.customizeBar}>
              {panelLayout.map((entry, i) => (
                <span
                  key={entry.id}
                  className={`${styles.customizeChip} ${entry.visible ? "" : styles.chipHidden}`}
                >
                  <span className={styles.chipLabel}>{PANEL_LABELS[entry.id]}</span>
                  <button
                    type="button"
                    className={styles.chipBtn}
                    disabled={i === 0}
                    onClick={() => movePanel(entry.id, -1)}
                    aria-label={`Move ${PANEL_LABELS[entry.id]} up`}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className={styles.chipBtn}
                    disabled={i === panelLayout.length - 1}
                    onClick={() => movePanel(entry.id, 1)}
                    aria-label={`Move ${PANEL_LABELS[entry.id]} down`}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className={styles.chipBtn}
                    onClick={() => togglePanelVisibility(entry.id)}
                    aria-label={
                      entry.visible
                        ? `Hide ${PANEL_LABELS[entry.id]}`
                        : `Show ${PANEL_LABELS[entry.id]}`
                    }
                  >
                    {entry.visible ? "◉" : "○"}
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        {panelLayout.filter((entry) => entry.visible).map((entry) => renderPanel(entry.id))}
      </div>
    </div>
  );
};

export default memo(MainContainer);
