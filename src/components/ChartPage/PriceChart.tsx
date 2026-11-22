import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  AreaSeries,
  BarSeries,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  PriceScaleMode,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type Logical,
  type SeriesType,
  type UTCTimestamp,
} from "lightweight-charts";
import { DrawingManager, type DrawingKind } from "lightweight-charts-drawing";
import type { Candle, CandleInterval } from "../../types/marketData";
import type { ViewLevel, ViewPattern } from "../../utils/timeframeMapping";
import { patternLabel, patternShort } from "../../utils/patternLabels";
import { drawPattern } from "./drawPattern";
import type { BookSample } from "../../utils/liquidityHeatmap";
import type { HeatContrast } from "../../utils/heatmapRender";
import { timeToLogical } from "../../utils/orderFlow";
import { clearHeatmap, drawDepthProfile, drawHeatmap } from "./drawHeatmap";
import { TF_MS } from "../../utils/timeframeMapping";
import { drawBigTrades } from "./drawBigTrades";
import { drawFootprint } from "./drawFootprint";
import type { Footprint } from "../../custom-hooks/useFootprint";
import type { BigTrades } from "../../custom-hooks/useBigTrades";
import { computeVolumeProfile } from "../../utils/volumeProfile";
import {
  computeInstance,
  INDICATOR_BY_ID,
  instanceTitle,
  type IndicatorInstance,
} from "../../utils/indicatorRegistry";
import { heikinAshi, tfLabel, type ChartType, type ScaleMode } from "../../utils/chartDisplay";
import { price as fmtPrice } from "../../utils/format";
import styles from "./ChartPage.module.scss";

export interface Layers {
  zones: boolean;
  orderBlocks: boolean;
  fvg: boolean;
  vp: boolean;
  pattern: boolean;
  heatmap: boolean;
  /** How hard the heatmap's colour saturates (share of visible cells below full brightness). */
  heatContrast: HeatContrast;
  bigTrades: boolean;
  footprint: boolean;
  /** Text labels on zones and blocks. */
  labels: boolean;
}

/** Imperative actions for the toolbar. */
export interface ChartHandle {
  /** PNG data URL of the chart with our overlay, or null. */
  screenshot: () => string | null;
  clearDrawings: () => void;
}

export type IndicatorAction = "toggle" | "settings" | "remove";

interface Props {
  symbol: string;
  /** Closed candles of the view timeframe. */
  candles: Candle[];
  viewTf: CandleInterval;
  /** The forming candle from the live stream (drawn, never analysed). */
  live: Candle | null;
  chartType: ChartType;
  scale: ScaleMode;
  indicators: IndicatorInstance[];
  onIndicator: (uid: string, action: IndicatorAction) => void;
  /** Zones, order blocks and gaps mapped onto the view (any source timeframe). */
  levels: ViewLevel[];
  /** Order-book snapshots (recorded history, then live) for the heatmap layer, ascending. */
  heatmap?: readonly BookSample[] | null;
  /** Big taker orders since the page opened (bubbles layer). */
  bigTrades?: BigTrades | null;
  /** Volume by price per bar since the page opened (footprint layer). */
  footprint?: Footprint | null;
  /** The selected setup mapped onto the view. */
  selected: ViewPattern | null;
  /** Changes when the user picks a pattern: the chart scrolls to it then, and only then. */
  focusKey?: string | null;
  /** Other recent patterns, drawn as small timeframe tags. */
  others: ViewPattern[];
  layers: Layers;
  tool: DrawingKind | null;
  onToolChange: (tool: DrawingKind | null) => void;
  magnet: boolean;
  drawingsVisible: boolean;
  handleRef: React.MutableRefObject<ChartHandle | null>;
}

/** Colour per detection timeframe (also used by the page's badges). */
export const TF_COLOR: Record<string, string> = {
  "1h": "#C084FC",
  "4h": "#4C9AFF",
  "1d": "#F0A35E",
};

const C = {
  up: "#56D364",
  down: "#F47067",
  signal: "#4C9AFF",
  amber: "#F0A35E",
  fg: "#E6EDF3",
  muted: "#9AA7B4",
  grid: "rgba(148,170,200,0.07)",
  line: "#263041",
};

const t = (ms: number) => Math.floor(ms / 1000) as UTCTimestamp;
/** Price pane height relative to one indicator pane (TradingView-like proportions). */
const MAIN_PANE_SHARE = 4;

/** Histogram bars of indicator panes (MACD, delta): teal above zero, red below. */
const histColor = (v: number) => (v >= 0 ? "rgba(38,166,154,0.6)" : "rgba(239,83,80,0.6)");

interface IndicatorSeries {
  uid: string;
  inst: IndicatorInstance;
  pane: number;
  isVolume: boolean;
  series: { key: string; api: ISeriesApi<SeriesType> }[];
  values: Record<string, number[]>;
}

function mainSeriesFor(chart: IChartApi, type: ChartType): ISeriesApi<SeriesType> {
  switch (type) {
    case "bars":
      return chart.addSeries(BarSeries, { upColor: C.up, downColor: C.down, thinBars: false });
    case "line":
      return chart.addSeries(LineSeries, { color: C.signal, lineWidth: 2 });
    case "area":
      return chart.addSeries(AreaSeries, {
        lineColor: C.signal,
        topColor: "rgba(76,154,255,0.35)",
        bottomColor: "rgba(76,154,255,0.02)",
        lineWidth: 2,
      });
    case "hollow":
      return chart.addSeries(CandlestickSeries, {
        upColor: "rgba(0,0,0,0)",
        downColor: C.down,
        borderUpColor: C.up,
        borderDownColor: C.down,
        wickUpColor: C.up,
        wickDownColor: C.down,
        borderVisible: true,
      });
    default:
      return chart.addSeries(CandlestickSeries, {
        upColor: C.up,
        downColor: C.down,
        wickUpColor: C.up,
        wickDownColor: C.down,
        borderVisible: false,
      });
  }
}

function toBar(c: Candle, type: ChartType) {
  return type === "line" || type === "area"
    ? { time: t(c.openTime), value: c.close }
    : { time: t(c.openTime), open: c.open, high: c.high, low: c.low, close: c.close };
}

const PriceChart: React.FC<Props> = ({
  symbol,
  candles,
  viewTf,
  live,
  chartType,
  scale,
  indicators,
  onIndicator,
  levels,
  heatmap = null,
  bigTrades = null,
  footprint = null,
  selected,
  focusKey = null,
  others,
  layers,
  tool,
  onToolChange,
  magnet,
  drawingsVisible,
  handleRef,
}) => {
  const boxRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const heatRef = useRef<HTMLCanvasElement>(null);
  const focusedRef = useRef<string | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const mainRef = useRef<{ api: ISeriesApi<SeriesType>; type: ChartType } | null>(null);
  const drawingsRef = useRef<DrawingManager | null>(null);
  const indRef = useRef<IndicatorSeries[]>([]);
  const displayRef = useRef<Candle[]>([]);
  const propsRef = useRef({
    candles,
    viewTf,
    levels,
    heatmap,
    bigTrades,
    footprint,
    live,
    selected,
    others,
    layers,
  });
  const drawRef = useRef<() => void>(() => {});
  const onToolRef = useRef(onToolChange);
  const symbolRef = useRef(symbol);
  const [hover, setHover] = useState<number | null>(null);
  const [paneTops, setPaneTops] = useState<number[]>([0]);
  // Legend data (state, so render never reads the mutable series refs).
  const [legend, setLegend] = useState<Pick<IndicatorSeries, "uid" | "pane" | "values">[]>([]);

  useLayoutEffect(() => {
    propsRef.current = {
      candles,
      viewTf,
      levels,
      heatmap,
      bigTrades,
      footprint,
      live,
      selected,
      others,
      layers,
    };
    onToolRef.current = onToolChange;
  });

  const measurePanes = () => {
    const chart = chartRef.current;
    if (!chart) return;
    const tops: number[] = [];
    let y = 0;
    for (const p of chart.panes()) {
      tops.push(y);
      y += p.getHeight() + 1; // 1 px separator
    }
    setPaneTops((prev) => (prev.join() === tops.join() ? prev : tops));
  };

  // Create the chart once.
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const chart = createChart(box, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: C.muted,
        fontFamily: "JetBrains Mono, ui-monospace, monospace",
        fontSize: 11,
        panes: { separatorColor: C.line, separatorHoverColor: "rgba(76,154,255,0.3)" },
      },
      grid: { vertLines: { color: C.grid }, horzLines: { color: C.grid } },
      rightPriceScale: { borderColor: C.line },
      timeScale: { borderColor: C.line, timeVisible: true, rightOffset: 12 },
      crosshair: { mode: CrosshairMode.Normal },
    });
    chartRef.current = chart;
    const redraw = () => drawRef.current();
    chart.timeScale().subscribeVisibleLogicalRangeChange(redraw);
    chart.subscribeCrosshairMove((param) => {
      setHover(param.logical === undefined ? null : Math.round(param.logical));
    });
    const ro = new ResizeObserver(() =>
      requestAnimationFrame(() => {
        measurePanes();
        redraw();
      }),
    );
    ro.observe(box);
    return () => {
      ro.disconnect();
      drawingsRef.current?.destroy();
      drawingsRef.current = null;
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(redraw);
      chart.remove();
      chartRef.current = null;
      mainRef.current = null;
    };
  }, []);

  // Main series: (re)built when the chart type changes, data on every candle set.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    let main = mainRef.current;
    if (!main || main.type !== chartType) {
      const saved = drawingsRef.current?.exportJSON();
      drawingsRef.current?.destroy();
      if (main) chart.removeSeries(main.api);
      const api = mainSeriesFor(chart, chartType);
      main = { api, type: chartType };
      mainRef.current = main;
      const dm = new DrawingManager(chart, api, { magnet: magnet ? "weak" : "off" });
      dm.on("tool", (k) => onToolRef.current(k));
      dm.on("change", () => {
        try {
          localStorage.setItem(`chart:drawings:${symbolRef.current}`, dm.exportJSON());
        } catch {
          // storage blocked
        }
      });
      if (saved) dm.importJSON(saved);
      drawingsRef.current = dm;
    }
    const display = chartType === "heikinAshi" ? heikinAshi(candles) : candles;
    displayRef.current = display;
    main.api.setData(display.map((c) => toBar(c, chartType)));
    requestAnimationFrame(() => drawRef.current());
  }, [candles, chartType]); // eslint-disable-line react-hooks/exhaustive-deps

  // Drawings belong to the symbol (shared across timeframes).
  useEffect(() => {
    symbolRef.current = symbol;
    const dm = drawingsRef.current;
    if (!dm) return;
    dm.clear();
    try {
      const saved = localStorage.getItem(`chart:drawings:${symbol}`);
      if (saved) dm.importJSON(saved);
    } catch {
      // ignore unreadable saved drawings
    }
  }, [symbol, chartType]);

  useEffect(() => {
    drawingsRef.current?.setTool(tool);
  }, [tool, chartType]);
  useEffect(() => {
    drawingsRef.current?.setMagnet(magnet ? "weak" : "off");
  }, [magnet, chartType]);
  useEffect(() => {
    drawingsRef.current?.setDrawingsVisible(drawingsVisible);
  }, [drawingsVisible, chartType]);

  // Fit the recent range when the symbol or timeframe changes.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || candles.length === 0) return;
    chart.timeScale().setVisibleLogicalRange({
      from: Math.max(0, candles.length - 160),
      to: candles.length + 10,
    });
  }, [symbol, viewTf, candles.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  // Live forming candle: drawn on top of the closed history.
  useEffect(() => {
    const main = mainRef.current;
    const last = candles[candles.length - 1];
    if (!main || !live || !last || live.openTime <= last.openTime) return;
    let bar = live;
    if (main.type === "heikinAshi") {
      const prev = displayRef.current[displayRef.current.length - 1];
      bar = heikinAshi([prev, live])[1];
      bar = { ...bar, open: (prev.open + prev.close) / 2 };
    }
    main.api.update(toBar(bar, main.type));
    const vol = indRef.current.find((s) => s.isVolume);
    vol?.series[0]?.api.update({
      time: t(live.openTime),
      value: live.volume,
      color: live.close >= live.open ? "rgba(86,211,100,0.35)" : "rgba(244,112,103,0.35)",
    });
    // Indicators that make sense before the close (delta, CVD) follow the forming candle.
    let withLive: Candle[] | null = null;
    for (const s of indRef.current) {
      const def = INDICATOR_BY_ID.get(s.inst.id);
      if (!def?.live) continue;
      withLive ??= [...candles, live];
      const values = computeInstance(s.inst, withLive);
      for (const x of s.series) {
        const v = values[x.key]?.[candles.length];
        if (v === undefined || !Number.isFinite(v)) continue;
        const kind = def.plots.find((p) => p.key === x.key)?.kind;
        x.api.update(
          kind === "histogram"
            ? { time: t(live.openTime), value: v, color: histColor(v) }
            : { time: t(live.openTime), value: v },
        );
      }
    }
  }, [live, candles]);

  // Indicators: rebuild their series and panes when the list or candles change.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    for (const s of indRef.current) for (const x of s.series) chart.removeSeries(x.api);
    indRef.current = [];
    for (let p = chart.panes().length - 1; p >= 1; p--) chart.removePane(p);
    let nextPane = 1;
    for (const inst of indicators) {
      const def = INDICATOR_BY_ID.get(inst.id);
      if (!def) continue;
      const values = computeInstance(inst, candles);
      const pane = def.placement === "pane" ? nextPane++ : 0;
      const series: IndicatorSeries["series"] = [];
      for (const plot of def.plots) {
        const color = inst.colors[plot.key] ?? plot.color;
        const v = values[plot.key];
        let api: ISeriesApi<SeriesType>;
        if (def.placement === "volume") {
          api = chart.addSeries(
            HistogramSeries,
            {
              priceScaleId: "vol",
              priceFormat: { type: "volume" },
              lastValueVisible: false,
              priceLineVisible: false,
            },
            0,
          );
          chart.priceScale("vol", 0).applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
          api.setData(
            candles.map((c) => ({
              time: t(c.openTime),
              value: c.volume,
              color: c.close >= c.open ? "rgba(86,211,100,0.35)" : "rgba(244,112,103,0.35)",
            })),
          );
        } else if (plot.kind === "histogram") {
          api = chart.addSeries(
            HistogramSeries,
            { lastValueVisible: false, priceLineVisible: false },
            pane,
          );
          api.setData(
            candles.flatMap((c, i) =>
              Number.isFinite(v[i])
                ? [
                    {
                      time: t(c.openTime),
                      value: v[i],
                      color: histColor(v[i]),
                    },
                  ]
                : [],
            ),
          );
        } else {
          api = chart.addSeries(
            LineSeries,
            {
              color,
              lineWidth: plot.kind === "dots" ? 1 : 2,
              lineVisible: plot.kind !== "dots",
              pointMarkersVisible: plot.kind === "dots",
              pointMarkersRadius: 1.5,
              lastValueVisible: def.placement === "pane",
              priceLineVisible: false,
              crosshairMarkerVisible: false,
            },
            pane,
          );
          api.setData(
            candles.flatMap((c, i) =>
              Number.isFinite(v[i]) ? [{ time: t(c.openTime), value: v[i] }] : [],
            ),
          );
        }
        api.applyOptions({ visible: inst.visible });
        series.push({ key: plot.key, api });
      }
      for (const level of def.levels ?? []) {
        series[0]?.api.createPriceLine({
          price: level,
          color: "rgba(154,167,180,0.5)",
          lineStyle: LineStyle.Dashed,
          lineWidth: 1,
          axisLabelVisible: false,
          title: "",
        });
      }
      indRef.current.push({
        uid: inst.uid,
        inst,
        pane,
        series,
        values,
        isVolume: def.placement === "volume",
      });
    }
    // Price pane keeps most of the height; each indicator pane gets an equal share.
    chart.panes().forEach((p, i) => p.setStretchFactor(i === 0 ? MAIN_PANE_SHARE : 1));
    requestAnimationFrame(() => {
      measurePanes();
      drawRef.current();
    });
    setLegend(indRef.current.map(({ uid, pane, values }) => ({ uid, pane, values })));
  }, [indicators, candles]);

  // Price scale mode.
  useEffect(() => {
    chartRef.current?.priceScale("right", 0).applyOptions({
      mode:
        scale === "log"
          ? PriceScaleMode.Logarithmic
          : scale === "percent"
            ? PriceScaleMode.Percentage
            : PriceScaleMode.Normal,
    });
  }, [scale]);

  // Toolbar actions.
  useEffect(() => {
    handleRef.current = {
      screenshot: () => {
        const chart = chartRef.current;
        if (!chart) return null;
        const shot = chart.takeScreenshot();
        const overlay = overlayRef.current;
        const g = shot.getContext("2d");
        if (overlay && g)
          g.drawImage(overlay, 0, 0, shot.width, (overlay.height / overlay.width) * shot.width);
        return shot.toDataURL("image/png");
      },
      clearDrawings: () => drawingsRef.current?.clear(),
    };
  }, [handleRef]);

  // Overlay: zones, volume profile of the visible range, pattern drawing (price pane only).
  function drawOverlay() {
    const chart = chartRef.current;
    const main = mainRef.current;
    const canvas = overlayRef.current;
    const box = boxRef.current;
    if (!chart || !main || !canvas || !box) return;
    const {
      candles: cs,
      viewTf: vtf,
      levels: lvs,
      heatmap: hm,
      bigTrades: bt,
      footprint: fp,
      live: lv,
      selected: sel,
      others: oth,
      layers: ly,
    } = propsRef.current;
    const dpr = window.devicePixelRatio || 1;
    const w = box.clientWidth;
    const h = chart.panes()[0]?.getHeight() ?? box.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const g = canvas.getContext("2d");
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const ts = chart.timeScale();
    const range = ts.getVisibleLogicalRange();
    if (!range || cs.length === 0) return;
    const plotW = ts.width();
    // logicalToCoordinate only handles whole bar indices (fractions return 0), so
    // positions between bars (e.g. a 4h close on a 1h view) are interpolated.
    const x = (l: number): number | null => {
      const i = Math.floor(l);
      const a = ts.logicalToCoordinate(i as Logical);
      if (a === null || l === i) return a;
      const b = ts.logicalToCoordinate((i + 1) as Logical);
      return b === null ? a : a + (b - a) * (l - i);
    };
    const y = (p: number) => main.api.priceToCoordinate(p);
    g.save();
    g.beginPath();
    g.rect(0, 0, plotW, h);
    g.clip();
    g.font = "11px JetBrains Mono, monospace";
    g.textBaseline = "middle";

    // The forming bar sits right after the last closed one, whatever the clock says (the
    // history can lag), so live data is placed on it rather than by elapsed time.
    const bars = lv && cs.length && lv.openTime > cs[cs.length - 1].openTime ? [...cs, lv] : cs;
    const xAt = (time: number) => {
      const l = timeToLogical(bars, time, TF_MS[vtf]);
      return l === null ? null : x(l);
    };
    const heatOn = ly.heatmap && hm && hm.length > 0 && heatRef.current;
    if (heatOn) drawHeatmap(heatRef.current!, hm, xAt, y, plotW, h, ly.heatContrast);
    else clearHeatmap(heatRef.current);

    // A selected pattern is the subject: levels and the volume profile step back.
    g.globalAlpha = ly.pattern && sel ? 0.35 : 1;
    const LEVEL_STYLE = {
      zone: { on: ly.zones, alpha: 0.12 },
      orderBlock: { on: ly.orderBlocks, alpha: 0.1 },
      fvg: { on: ly.fvg, alpha: 0.07 },
    } as const;
    for (const z of lvs) {
      const st = LEVEL_STYLE[z.layer];
      if (!st.on) continue;
      const end = z.to ?? cs.length + 12;
      if (end < range.from || z.from > range.to) continue;
      const x1 = x(z.from) ?? 0;
      const x2 = z.to === null ? plotW : (x(end) ?? plotW);
      const yTop = y(z.high);
      const yBot = y(z.low);
      if (yTop === null || yBot === null) continue;
      const bull = z.kind === "demand" || z.kind === "bullish";
      const rgb = bull ? "86,211,100" : "244,112,103";
      const intact = z.to === null;
      g.fillStyle = `rgba(${rgb},${intact ? st.alpha : st.alpha / 2.5})`;
      g.fillRect(x1, yTop, x2 - x1, yBot - yTop);
      if (z.layer === "orderBlock") {
        g.setLineDash([4, 3]);
        g.strokeStyle = intact ? "rgba(76,154,255,0.8)" : "rgba(76,154,255,0.3)";
        g.strokeRect(x1 + 0.5, yTop + 0.5, x2 - x1 - 1, yBot - yTop - 1);
        g.setLineDash([]);
      } else if (z.layer === "zone" && intact) {
        g.strokeStyle = `rgba(${rgb},0.45)`;
        g.strokeRect(x1 + 0.5, yTop + 0.5, x2 - x1 - 1, yBot - yTop - 1);
      }
      if (ly.labels && intact && z.layer !== "fvg") {
        const name =
          z.layer === "orderBlock" ? `${bull ? "bull" : "bear"} OB` : bull ? "demand" : "supply";
        g.fillStyle = z.layer === "orderBlock" ? "rgba(76,154,255,0.95)" : `rgba(${rgb},0.9)`;
        g.fillText(`${z.tf} ${name}${z.fresh ? " · fresh" : ""}`, Math.max(x1, 0) + 4, yBot - 8);
      }
    }

    if (ly.vp) {
      const from = Math.max(0, Math.floor(range.from));
      const to = Math.min(cs.length - 1, Math.ceil(range.to));
      const vp = to > from ? computeVolumeProfile(cs.slice(from, to + 1), 40) : null;
      if (vp) {
        const max = Math.max(...vp.volumes);
        const maxW = plotW * 0.18;
        const vaLo = Math.floor((vp.valPrice - vp.low) / vp.binSize);
        const vaHi = Math.ceil((vp.vahPrice - vp.low) / vp.binSize) - 1;
        vp.volumes.forEach((v, b) => {
          const yTop = y(vp.low + (b + 1) * vp.binSize);
          const yBot = y(vp.low + b * vp.binSize);
          if (yTop === null || yBot === null) return;
          g.fillStyle =
            b === vp.pocIndex
              ? "rgba(76,154,255,0.75)"
              : b >= vaLo && b <= vaHi
                ? "rgba(76,154,255,0.3)"
                : "rgba(148,170,200,0.15)";
          const bw = (v / max) * maxW;
          g.fillRect(plotW - bw, yTop + 0.5, bw, Math.max(1, yBot - yTop - 1));
        });
        // Light dashed POC, VAH and VAL across the chart, labelled beside the histogram.
        const lines: [string, number, string, string][] = [
          ["VAH", vp.vahPrice, "rgba(148,170,200,0.4)", "rgba(154,167,180,0.8)"],
          ["POC", vp.pocPrice, "rgba(76,154,255,0.55)", "rgba(76,154,255,0.85)"],
          ["VAL", vp.valPrice, "rgba(148,170,200,0.4)", "rgba(154,167,180,0.8)"],
        ];
        g.save();
        g.lineWidth = 1;
        g.setLineDash([4, 4]);
        g.font = "9.5px JetBrains Mono, monospace";
        g.textAlign = "right";
        for (const [tag, p, stroke, text] of lines) {
          const py = y(p);
          if (py === null) continue;
          g.strokeStyle = stroke;
          g.beginPath();
          g.moveTo(0, Math.round(py) + 0.5);
          g.lineTo(plotW, Math.round(py) + 0.5);
          g.stroke();
          g.fillStyle = text;
          g.fillText(`${tag} ${fmtPrice(p)}`, plotW - maxW - 6, py - 5);
        }
        g.restore();
      }
    }

    const tag = (px: number, py: number, text: string, color: string) => {
      const tw = g.measureText(text).width + 10;
      g.fillStyle = color;
      g.beginPath();
      g.roundRect(px - tw / 2, py - 8, tw, 16, 4);
      g.fill();
      g.fillStyle = "#0B0F14";
      g.fillText(text, px - tw / 2 + 5, py);
    };

    if (ly.pattern) {
      // Other recent patterns: a small tag where each one's signal closed.
      for (const o of oth) {
        if (o === sel || o.entryX < range.from - 2 || o.entryX > range.to + 2) continue;
        const px = x(o.entryX);
        const py = y(o.extreme);
        if (px === null || py === null) continue;
        const arrow = o.direction === "long" ? "▲" : "▼";
        tag(
          px,
          py + (o.direction === "long" ? 16 : -16),
          `${o.tf} ${arrow}${patternShort(o.pattern)}`,
          TF_COLOR[o.tf] ?? C.muted,
        );
      }
    }

    g.globalAlpha = 1;
    if (ly.pattern && sel) {
      const barW = ts.options().barSpacing;
      // The tag ("Bear flag · 1d") names the source timeframe; its candles are not shaded.
      drawPattern(g, sel, `${patternLabel(sel.pattern)} · ${sel.tf}`, cs, x, y, barW);
      g.lineWidth = 1;
    }
    // Last, so live prints stay visible above zones and the pattern drawing.
    if (heatOn) drawDepthProfile(g, hm[hm.length - 1], y, plotW, h);
    if (ly.footprint && fp) drawFootprint(g, fp.bars, fp.step, bars, TF_MS[vtf], x, y, h);
    if (ly.bigTrades && bt) drawBigTrades(g, bt.prints, bt.threshold, bars, vtf, x, y);
    g.restore();
  }

  useLayoutEffect(() => {
    drawRef.current = drawOverlay;
  });

  useEffect(() => {
    requestAnimationFrame(() => drawRef.current());
  }, [levels, heatmap, bigTrades, footprint, others, layers]);

  // Selected setup: scroll it into view.
  useEffect(() => {
    const chart = chartRef.current;
    if (!mainRef.current || !chart) return;
    // Scroll to the pattern only when the user picked it, never on a data refresh
    // (otherwise every candle close would pull the view away from the latest candle).
    if (selected && layers.pattern && focusKey !== null && focusKey !== focusedRef.current) {
      focusedRef.current = focusKey;
      const len = propsRef.current.candles.length;
      // Candlestick patterns are a few candles: a closer view keeps their shape readable.
      const minSpan = selected.lines.length > 0 ? 110 : 60;
      const span = Math.max(minSpan, selected.entryX - selected.startX + 40);
      chart.timeScale().setVisibleLogicalRange({
        from: Math.max(0, selected.startX - (span - (selected.entryX - selected.startX)) * 0.7),
        to: Math.min(len + 10, selected.entryX + 50),
      });
    }
    requestAnimationFrame(() => drawRef.current());
  }, [selected, layers.pattern, chartType, focusKey]);

  // Legend values: hovered bar, else the latest (forming candle when live).
  const n = candles.length;
  const idx = hover !== null && hover >= 0 && hover < n ? hover : n - 1;
  const bar =
    hover === null && live && candles[n - 1] && live.openTime > candles[n - 1].openTime
      ? live
      : candles[idx];
  const prev = candles[idx - 1];
  const chg = bar && prev ? ((bar.close - prev.close) / prev.close) * 100 : null;
  const val = (v: number | undefined) =>
    v === undefined || !Number.isFinite(v) ? "∅" : fmtPrice(v);

  return (
    <div className={styles.chartArea}>
      <canvas ref={heatRef} className={styles.heat} aria-hidden="true" />
      <div ref={boxRef} className={styles.chartBox} />
      <canvas ref={overlayRef} className={styles.overlay} aria-hidden="true" />
      <div className={styles.legend0} style={{ top: 6 }}>
        <div className={styles.legendMain}>
          <b>{symbol.replace("-", "")}</b>
          <span>· {tfLabel(viewTf)} · Binance</span>
          {bar && (
            <span className={`${styles.ohlc} ${bar.close >= bar.open ? styles.up : styles.down}`}>
              <i>O</i>
              {fmtPrice(bar.open)} <i>H</i>
              {fmtPrice(bar.high)} <i>L</i>
              {fmtPrice(bar.low)} <i>C</i>
              {fmtPrice(bar.close)}
              {chg !== null && ` ${chg >= 0 ? "+" : "−"}${Math.abs(chg).toFixed(2)}%`}
            </span>
          )}
        </div>
        {legend
          .filter((s) => s.pane === 0)
          .map((s) => (
            <LegendRow
              key={s.uid}
              s={s}
              inst={indicators.find((i) => i.uid === s.uid)}
              idx={idx}
              val={val}
              onAction={onIndicator}
            />
          ))}
      </div>
      {legend
        .filter((s) => s.pane > 0)
        .map((s) => (
          <div key={s.uid} className={styles.legend0} style={{ top: (paneTops[s.pane] ?? 0) + 4 }}>
            <LegendRow
              s={s}
              inst={indicators.find((i) => i.uid === s.uid)}
              idx={idx}
              val={val}
              onAction={onIndicator}
            />
          </div>
        ))}
    </div>
  );
};

function LegendRow({
  s,
  inst,
  idx,
  val,
  onAction,
}: {
  s: Pick<IndicatorSeries, "values">;
  inst: IndicatorInstance | undefined;
  idx: number;
  val: (v: number | undefined) => string;
  onAction: (uid: string, action: IndicatorAction) => void;
}) {
  if (!inst) return null;
  const def = INDICATOR_BY_ID.get(inst.id)!;
  const title = instanceTitle(inst);
  return (
    <div className={`${styles.legendRow} ${inst.visible ? "" : styles.legendHidden}`}>
      <span className={styles.legendTitle}>{title}</span>
      {inst.visible &&
        def.placement !== "volume" &&
        def.plots.map((p) => (
          <span
            key={p.key}
            style={{ color: inst.colors[p.key] ?? p.color }}
            className={styles.legendVal}
          >
            {val(s.values[p.key]?.[idx])}
          </span>
        ))}
      <span className={styles.legendBtns}>
        <button
          type="button"
          aria-label={`${inst.visible ? "Hide" : "Show"} ${title}`}
          onClick={() => onAction(inst.uid, "toggle")}
        >
          {inst.visible ? "◉" : "○"}
        </button>
        {def.inputs.length > 0 && (
          <button
            type="button"
            aria-label={`Settings for ${title}`}
            onClick={() => onAction(inst.uid, "settings")}
          >
            ⚙
          </button>
        )}
        <button
          type="button"
          aria-label={`Remove ${title}`}
          onClick={() => onAction(inst.uid, "remove")}
        >
          ✕
        </button>
      </span>
    </div>
  );
}

export default PriceChart;
