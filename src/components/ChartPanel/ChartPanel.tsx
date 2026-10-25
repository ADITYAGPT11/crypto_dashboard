import { useEffect, useMemo, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  HistogramSeries,
  LineSeries,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { useCandles, type CandleSource } from "../../custom-hooks/useCandles";
import {
  CANDLE_INTERVALS,
  type Candle,
  type CandleInterval,
  type ExchangeName,
  type MarketType,
} from "../../types/marketData";
import { MIN_CANDLES_FOR_INDICATORS } from "../../utils/candleUtils";
import {
  atr,
  bollingerBands,
  ema,
  macd,
  rsi,
  sma,
  vwap,
  type CandleLike,
} from "../../utils/indicators";
import styles from "./ChartPanel.module.scss";

// ---------------------------------------------------------------------------
// Indicator configuration
// ---------------------------------------------------------------------------

type IndicatorId = "sma" | "ema" | "bb" | "vwap" | "rsi" | "atr" | "macd";

interface IndicatorConfig {
  id: IndicatorId;
  visible: boolean;
  params: { period: number; mult?: number; fast?: number; slow?: number; signal?: number };
}

const INDICATOR_DEFAULTS: IndicatorConfig[] = [
  { id: "sma", visible: false, params: { period: 20 } },
  { id: "ema", visible: false, params: { period: 50 } },
  { id: "bb", visible: false, params: { period: 20, mult: 2 } },
  { id: "vwap", visible: false, params: { period: 1 } },
  { id: "rsi", visible: false, params: { period: 14 } },
  { id: "atr", visible: false, params: { period: 14 } },
  { id: "macd", visible: false, params: { period: 9, fast: 12, slow: 26, signal: 9 } },
];

const INDICATOR_LABELS: Record<IndicatorId, string> = {
  sma: "SMA",
  ema: "EMA",
  bb: "Bollinger",
  vwap: "VWAP",
  rsi: "RSI",
  atr: "ATR",
  macd: "MACD",
};

/** Aux indicators that get their own pane below the price chart. */
const PANE_IDS: IndicatorId[] = ["rsi", "atr", "macd"];

/** Chart data sources available in scope; Delta India has no candle stream yet. */
const SOURCES: Array<{ exchange: ExchangeName; type: MarketType; label: string }> = [
  { exchange: "BINANCE", type: "SPOT", label: "Binance Spot" },
  { exchange: "BINANCE", type: "FUT", label: "Binance Futures" },
  { exchange: "OKX", type: "SPOT", label: "OKX Spot" },
  { exchange: "OKX", type: "FUT", label: "OKX Perp Swap" },
];

const LINE_COLORS: Record<string, string> = {
  sma: "#eab308",
  ema: "#38bdf8",
  bbUpper: "#a78bfa",
  bbMiddle: "#c4b5fd",
  bbLower: "#a78bfa",
  vwap: "#f472b6",
  rsi: "#22d3ee",
  atr: "#fb923c",
  macd: "#34d399",
  macdSignal: "#f97316",
};

type OverlaySeries = ISeriesApi<"Line" | "Histogram">;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface ChartPanelProps {
  /** User's watchlist symbols; the first one is the default selection. */
  symbols: string[];
}

const ChartPanel: React.FC<ChartPanelProps> = ({ symbols }) => {
  const [symbol, setSymbol] = useState<string>(symbols[0] ?? "BTC-USDT");
  const [sourceIdx, setSourceIdx] = useState(0);
  const [intervalSel, setIntervalSel] = useState<CandleInterval>("15m");
  const [indicators, setIndicators] = useState<IndicatorConfig[]>(INDICATOR_DEFAULTS);

  const source: CandleSource = useMemo(
    () => ({
      exchange: SOURCES[sourceIdx].exchange,
      type: SOURCES[sourceIdx].type,
      symbol,
      interval: intervalSel,
    }),
    [sourceIdx, symbol, intervalSel],
  );

  const { candles, loading, error } = useCandles(source);

  const auxCount = indicators.filter((i) => i.visible && PANE_IDS.includes(i.id)).length;

  // ---- chart + series lifecycle (rebuilt when pane composition changes) ----
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#9aa3b2",
        attributionLogo: true, // required attribution for Lightweight Charts™
      },
      grid: {
        vertLines: { color: "rgba(42,53,70,0.5)" },
        horzLines: { color: "rgba(42,53,70,0.5)" },
      },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false },
      crosshair: { mode: 1 }, // magnet over bars
    });
    chartRef.current = chart;
    candleSeriesRef.current = chart.addSeries(CandlestickSeries, {
      upColor: "#16a34a",
      downColor: "#ef5350",
      borderVisible: false,
      wickUpColor: "#16a34a",
      wickDownColor: "#ef5350",
    });

    const volume = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "",
    });
    volume.priceScale().applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });
    volumeSeriesRef.current = volume;

    return () => {
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
    };
  }, [auxCount]);

  // Distribute vertical space: price+volume pane ~60%, aux panes share the rest.
  useEffect(() => {
    if (auxCount === 0) return;
    const panes = chartRef.current?.panes() ?? [];
    if (panes.length < 2) return;
    const total = containerRef.current?.clientHeight ?? 420;
    const auxH = Math.max(72, (total * 0.4) / auxCount);
    const mainH = Math.max(220, total - auxH * auxCount);
    panes[0].setHeight(mainH);
    for (const p of panes.slice(1)) p.setHeight(auxH);
  }, [auxCount, indicators]);

  // ---- data plumbing ------------------------------------------------------
  const prevRef = useRef<{ key: string; len: number; lastOpen: number } | null>(null);
  const overlaySeriesRef = useRef<Map<string, OverlaySeries[]>>(new Map());

  useEffect(() => {
    const chart = chartRef.current;
    const candleSeries = candleSeriesRef.current;
    const volumeSeries = volumeSeriesRef.current;
    if (!chart || !candleSeries || !volumeSeries) return;

    const toTime = (ms: number) => ms / 1000;
    const key = `${source.exchange}|${source.type}|${source.symbol}|${source.interval}`;
    const prev = prevRef.current;

    // Tail update only when the live stream replaced the last bar (same count)
    // or appended exactly one newer bar after it.
    const tailOnly =
      prev !== null &&
      prev.key === key &&
      candles.length > 0 &&
      (candles.length === prev.len ||
        (candles.length === prev.len + 1 &&
          candles[candles.length - 1].openTime !== prev.lastOpen)) &&
      (candles.length === prev.len
        ? candles[candles.length - 1].openTime === prev.lastOpen
        : candles[candles.length - 2]?.openTime === prev.lastOpen);

    if (candles.length > 0) {
      if (!tailOnly) {
        candleSeries.setData(
          candles.map((c) => ({
            time: toTime(c.openTime) as UTCTimestamp,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
          })),
        );
        volumeSeries.setData(
          candles.map((c) => ({
            time: toTime(c.openTime) as UTCTimestamp,
            value: c.volume,
            color: c.close >= c.open ? "rgba(22,163,74,0.45)" : "rgba(239,83,80,0.45)",
          })),
        );
      } else {
        pushTail(candleSeries, candles[candles.length - 1], toTime);
      }
    }
    prevRef.current = {
      key,
      len: candles.length,
      lastOpen: candles[candles.length - 1]?.openTime ?? NaN,
    };

    applyIndicators({
      chart,
      candles,
      toTime,
      indicators,
      overlayRef: overlaySeriesRef.current,
      fullRefresh: true,
    });
  }, [candles, indicators, source]);

  // Rebuild overlays when the aux-pane composition changes (chart was removed).
  useEffect(() => {
    const chart = chartRef.current;
    if (chart && auxCount >= 0) {
      applyIndicators({
        chart,
        candles,
        toTime: (ms) => ms / 1000,
        indicators,
        overlayRef: overlaySeriesRef.current,
        fullRefresh: true,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auxCount]);

  const toggleIndicator = (id: IndicatorId) =>
    setIndicators((prev) => prev.map((i) => (i.id === id ? { ...i, visible: !i.visible } : i)));

  const setParam = (id: IndicatorId, param: string, value: number) =>
    setIndicators((prev) =>
      prev.map((i) => (i.id === id ? { ...i, params: { ...i.params, [param]: value } } : i)),
    );

  const notEnough = candles.length > 0 && candles.length < MIN_CANDLES_FOR_INDICATORS;

  return (
    <div className={styles.chartPanel}>
      <div className={styles.toolbar}>
        <select
          className={styles.select}
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
          aria-label="Chart symbol"
        >
          {(symbols.includes(symbol) ? symbols : [symbol, ...symbols]).map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        <select
          className={styles.select}
          value={sourceIdx}
          onChange={(e) => setSourceIdx(Number(e.target.value))}
          aria-label="Chart data source"
        >
          {SOURCES.map((s, i) => (
            <option key={`${s.exchange}-${s.type}`} value={i}>
              {s.label}
            </option>
          ))}
          <option disabled value={-1}>
            Delta India — candle stream not available
          </option>
        </select>

        <div className={styles.intervals}>
          {CANDLE_INTERVALS.map((iv) => (
            <button
              key={iv}
              className={`${styles.intervalBtn} ${iv === intervalSel ? styles.active : ""}`}
              onClick={() => setIntervalSel(iv)}
            >
              {iv}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.indicatorBar}>
        {indicators.map((ind) => (
          <div key={ind.id} className={`${styles.indicatorChip} ${ind.visible ? styles.on : ""}`}>
            <button
              className={styles.chipBtn}
              onClick={() => toggleIndicator(ind.id)}
              title={`${INDICATOR_LABELS[ind.id]} ${describeParams(ind)}`}
            >
              {INDICATOR_LABELS[ind.id]} {describeParams(ind)}
            </button>
            {ind.visible && ind.id !== "vwap" && ind.id !== "macd" && (
              <input
                className={styles.paramInput}
                type="number"
                value={ind.params.period}
                min={2}
                max={400}
                onChange={(e) =>
                  setParam(ind.id, "period", clampNumber(e.target.value, ind.params.period))
                }
                aria-label={`${INDICATOR_LABELS[ind.id]} period`}
              />
            )}
            {ind.visible && ind.id === "bb" && (
              <input
                className={styles.paramInput}
                type="number"
                value={ind.params.mult ?? 2}
                min={0.5}
                max={10}
                step={0.5}
                onChange={(e) =>
                  setParam(ind.id, "mult", clampNumber(e.target.value, ind.params.mult ?? 2))
                }
                aria-label="Bollinger multiplier"
              />
            )}
            {ind.visible && ind.id === "macd" && (
              <div className={styles.macdParams}>
                {(["fast", "slow", "signal"] as const).map((p) => (
                  <input
                    key={p}
                    className={styles.paramInput}
                    type="number"
                    value={ind.params[p] ?? 0}
                    min={1}
                    max={200}
                    onChange={(e) =>
                      setParam(ind.id, p, clampNumber(e.target.value, ind.params[p] ?? 12))
                    }
                    aria-label={`MACD ${p}`}
                  />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className={styles.chartArea}>
        <div ref={containerRef} className={styles.chartContainer} />
        {(loading || error || notEnough || candles.length === 0) && (
          <div className={styles.overlay}>
            {loading && <span>Loading candles…</span>}
            {error && !loading && (
              <span>
                History unavailable from this source ({error.message}). Try another exchange or
                market.
              </span>
            )}
            {notEnough && !loading && !error && (
              <span>
                Only {candles.length} candle{candles.length === 1 ? "" : "s"} received — indicators
                need at least {MIN_CANDLES_FOR_INDICATORS}.
              </span>
            )}
            {!loading && !error && !notEnough && candles.length === 0 && (
              <span>Waiting for the first candle…</span>
            )}
          </div>
        )}
      </div>

      <p className={styles.disclaimer}>
        Built with{" "}
        <a href="https://www.tradingview.com/lightweight-charts/" target="_blank" rel="noreferrer">
          Lightweight Charts™
        </a>{" "}
        on exchange data. Indicators are computed client-side from the loaded window only; values
        near the chart's left edge can shift when more history arrives. VWAP resets each UTC day and
        reflects the loaded candles, not the full trading session.
      </p>
    </div>
  );
};

function pushTail(
  candleSeries: ISeriesApi<"Candlestick">,
  candle: Candle,
  toTime: (ms: number) => number,
) {
  candleSeries.update({
    time: toTime(candle.openTime) as UTCTimestamp,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
  });
}

// ---------------------------------------------------------------------------
// Indicator series application
// ---------------------------------------------------------------------------

interface ApplyIndicatorsArgs {
  chart: IChartApi;
  candles: CandleLike[];
  toTime: (ms: number) => number;
  indicators: IndicatorConfig[];
  overlayRef: Map<string, OverlaySeries[]>;
  fullRefresh: boolean;
}

function applyIndicators(args: ApplyIndicatorsArgs) {
  const { chart, candles, toTime, indicators, overlayRef, fullRefresh } = args;

  // Overlays are rebuilt from scratch on every pass: a handful of series, and
  // rebuilding avoids stale-pane/leftover-series bugs across config changes.
  for (const list of overlayRef.values()) {
    for (const s of list) chart.removeSeries(s);
  }
  overlayRef.clear();
  if (candles.length < 2) return;

  // Always a full refresh through setData once `tailOnly` handling pushed the
  // candle tail; indicator values are recomputed over the whole window.
  if (!fullRefresh) return;

  const closes = candles.map((c) => c.close);
  const addLine = (
    data: Array<{ time: UTCTimestamp; value: number } | null>,
    paneIndex: number,
    color: string,
    lineStyle?: 0 | 2,
    lineWidth?: 1 | 2,
  ): OverlaySeries => {
    const series = chart.addSeries(
      LineSeries,
      { color, lineWidth: lineWidth ?? 1, lineStyle: lineStyle ?? 0, priceLineVisible: false },
      paneIndex,
    );
    series.setData(data.filter((p): p is { time: UTCTimestamp; value: number } => p !== null));
    return series as OverlaySeries;
  };
  const lineData = (values: number[]) =>
    values.map((v, i) =>
      Number.isFinite(v) ? { time: toTime(candles[i].openTime) as UTCTimestamp, value: v } : null,
    );

  for (const ind of indicators) {
    if (!ind.visible) continue;
    const period = ind.params.period;

    switch (ind.id) {
      case "sma": {
        overlayRef.set(ind.id, [addLine(lineData(sma(closes, period)), 0, LINE_COLORS.sma)]);
        break;
      }
      case "ema": {
        overlayRef.set(ind.id, [addLine(lineData(ema(closes, period)), 0, LINE_COLORS.ema)]);
        break;
      }
      case "bb": {
        const bb = bollingerBands(closes, period, ind.params.mult ?? 2);
        const list = (["upper", "middle", "lower"] as const).map((k, idx) =>
          addLine(
            lineData(bb.map((p) => p[k])),
            0,
            idx === 1 ? LINE_COLORS.bbMiddle : LINE_COLORS.bbUpper,
            idx === 1 ? 0 : 2,
            idx === 1 ? 2 : 1,
          ),
        );
        overlayRef.set(ind.id, list);
        break;
      }
      case "vwap": {
        overlayRef.set(ind.id, [addLine(lineData(vwap(candles)), 0, LINE_COLORS.vwap)]);
        break;
      }
      case "rsi": {
        overlayRef.set(ind.id, [
          addLine(lineData(rsi(closes, period)), paneOf(ind.id, indicators), LINE_COLORS.rsi),
        ]);
        break;
      }
      case "atr": {
        overlayRef.set(ind.id, [
          addLine(lineData(atr(candles, period)), paneOf(ind.id, indicators), LINE_COLORS.atr),
        ]);
        break;
      }
      case "macd": {
        const pane = paneOf(ind.id, indicators);
        const out = macd(
          closes,
          ind.params.fast ?? 12,
          ind.params.slow ?? 26,
          ind.params.signal ?? 9,
        );
        const macdLine = addLine(lineData(out.map((p) => p.macd)), pane, LINE_COLORS.macd);
        const signalLine = addLine(
          lineData(out.map((p) => p.signal)),
          pane,
          LINE_COLORS.macdSignal,
        );
        const hist = chart.addSeries(HistogramSeries, { priceLineVisible: false }, pane);
        hist.setData(
          out
            .map((p, i) => ({
              time: toTime(candles[i].openTime) as UTCTimestamp,
              value: p.histogram,
              color: p.histogram >= 0 ? "rgba(52,211,153,0.6)" : "rgba(239,83,80,0.6)",
            }))
            .filter((p) => Number.isFinite(p.value)),
        );
        overlayRef.set(ind.id, [macdLine, signalLine, hist as OverlaySeries]);
        break;
      }
    }
  }
}

/** Pane index of an aux indicator: overlays on pane 0, each aux id gets its own. */
function paneOf(id: IndicatorId, indicators: IndicatorConfig[]): number {
  const visibleAux = indicators.filter((i) => i.visible && PANE_IDS.includes(i.id));
  return 1 + visibleAux.findIndex((i) => i.id === id);
}

function describeParams(ind: IndicatorConfig): string {
  switch (ind.id) {
    case "bb":
      return `(${ind.params.period}, ${ind.params.mult ?? 2})`;
    case "macd":
      return `(${ind.params.fast ?? 12}, ${ind.params.slow ?? 26}, ${ind.params.signal ?? 9})`;
    case "vwap":
      return "(UTC day)";
    default:
      return `(${ind.params.period})`;
  }
}

function clampNumber(raw: string, fallback: number): number {
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) && n >= 0.5 && n <= 400 ? n : fallback;
}

export default ChartPanel;
