import { useEffect, useLayoutEffect, useRef } from "react";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type Logical,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import type { Candle, CandleInterval } from "../../types/marketData";
import type { OutcomeResult } from "../../types/analysis";
import type { ViewPattern, ViewZone } from "../../utils/timeframeMapping";
import { bollingerBands, ema } from "../../utils/indicators";
import { computeVolumeProfile } from "../../utils/volumeProfile";
import styles from "./ChartPage.module.scss";

export interface Layers {
  ema: boolean;
  bb: boolean;
  zones: boolean;
  vp: boolean;
  pattern: boolean;
}

/** Past case of the selected setup, already placed on a view bar. */
export interface ViewMarker {
  /** Open time (ms) of the view bar where the source candle closed. */
  time: number;
  result: OutcomeResult;
  current: boolean;
}

/** Plan prices of the selected setup. */
export interface Plan {
  entry: number;
  stop: number;
  target: number;
}

interface Props {
  /** Candles of the view timeframe. */
  candles: Candle[];
  viewTf: CandleInterval;
  /** Zones mapped onto the view (any source timeframe). */
  zones: ViewZone[];
  /** The selected setup mapped onto the view. */
  selected: ViewPattern | null;
  plan: Plan | null;
  /** Other recent patterns, drawn as small timeframe tags. */
  others: ViewPattern[];
  markers: ViewMarker[];
  layers: Layers;
}

/** Colour per detection timeframe (also used by the page's badges). */
export const TF_COLOR: Record<string, string> = {
  "1h": "#C084FC",
  "4h": "#4C9AFF",
  "1d": "#F0A35E",
};

const SHORT: Record<string, string> = {
  doubleBottom: "DB",
  bullishEngulfing: "BE",
  hammer: "H",
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

const PriceChart: React.FC<Props> = ({
  candles,
  viewTf,
  zones,
  selected,
  plan,
  others,
  markers,
  layers,
}) => {
  const boxRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<{
    candle: ISeriesApi<"Candlestick">;
    volume: ISeriesApi<"Histogram">;
    ema: ISeriesApi<"Line">;
    bbUpper: ISeriesApi<"Line">;
    bbLower: ISeriesApi<"Line">;
    markers: ISeriesMarkersPluginApi<Time>;
  } | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const propsRef = useRef({ candles, viewTf, zones, selected, others, layers });
  const drawRef = useRef<() => void>(() => {});
  // Keep the latest props for the imperative overlay (runs before paint, after render).
  useLayoutEffect(() => {
    propsRef.current = { candles, viewTf, zones, selected, others, layers };
  });

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
      },
      grid: { vertLines: { color: C.grid }, horzLines: { color: C.grid } },
      rightPriceScale: { borderColor: C.line },
      timeScale: { borderColor: C.line, timeVisible: true, rightOffset: 12 },
      crosshair: { mode: CrosshairMode.Normal },
    });
    const candle = chart.addSeries(CandlestickSeries, {
      upColor: C.up,
      downColor: C.down,
      wickUpColor: C.up,
      wickDownColor: C.down,
      borderVisible: false,
    });
    candle.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: 0.24 } });
    const volume = chart.addSeries(HistogramSeries, {
      priceScaleId: "vol",
      priceFormat: { type: "volume" },
      lastValueVisible: false,
      priceLineVisible: false,
    });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    const line = {
      lineWidth: 2 as const,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    };
    const emaSeries = chart.addSeries(LineSeries, { ...line, color: C.amber });
    const bbUpper = chart.addSeries(LineSeries, {
      ...line,
      lineWidth: 1,
      color: "rgba(125,180,255,0.6)",
    });
    const bbLower = chart.addSeries(LineSeries, {
      ...line,
      lineWidth: 1,
      color: "rgba(125,180,255,0.6)",
    });
    const markers = createSeriesMarkers(candle, []);
    chartRef.current = chart;
    seriesRef.current = { candle, volume, ema: emaSeries, bbUpper, bbLower, markers };

    const redraw = () => drawRef.current();
    chart.timeScale().subscribeVisibleLogicalRangeChange(redraw);
    const ro = new ResizeObserver(() => requestAnimationFrame(redraw));
    ro.observe(box);
    return () => {
      ro.disconnect();
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(redraw);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  // Overlay: zones, volume profile of the visible range, pattern drawing.
  function drawOverlay() {
    const chart = chartRef.current;
    const s = seriesRef.current;
    const canvas = overlayRef.current;
    const box = boxRef.current;
    if (!chart || !s || !canvas || !box) return;
    const {
      candles: cs,
      viewTf: vtf,
      zones: zs,
      selected: sel,
      others: oth,
      layers: ly,
    } = propsRef.current;
    const dpr = window.devicePixelRatio || 1;
    const w = box.clientWidth;
    const h = box.clientHeight;
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
    const y = (p: number) => s.candle.priceToCoordinate(p);
    g.save();
    g.beginPath();
    g.rect(0, 0, plotW, h);
    g.clip();
    g.font = "11px JetBrains Mono, monospace";
    g.textBaseline = "middle";

    if (ly.zones) {
      for (const z of zs) {
        const end = z.to ?? cs.length + 12;
        if (end < range.from || z.from > range.to) continue;
        const x1 = x(z.from) ?? 0;
        const x2 = z.to === null ? plotW : (x(end) ?? plotW);
        const yTop = y(z.high);
        const yBot = y(z.low);
        if (yTop === null || yBot === null) continue;
        const demand = z.kind === "demand";
        const intact = z.to === null;
        g.fillStyle = demand
          ? `rgba(86,211,100,${intact ? 0.12 : 0.05})`
          : `rgba(244,112,103,${intact ? 0.1 : 0.04})`;
        g.fillRect(x1, yTop, x2 - x1, yBot - yTop);
        if (intact) {
          g.strokeStyle = demand ? "rgba(86,211,100,0.45)" : "rgba(244,112,103,0.4)";
          g.strokeRect(x1 + 0.5, yTop + 0.5, x2 - x1 - 1, yBot - yTop - 1);
        }
        if (z.tf !== vtf && intact) {
          g.fillStyle = demand ? "rgba(86,211,100,0.9)" : "rgba(244,112,103,0.9)";
          g.fillText(`${z.tf} ${z.kind}`, Math.max(x1, 0) + 4, yBot - 8);
        }
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
        const yPoc = y(vp.pocPrice);
        if (yPoc !== null) {
          g.setLineDash([5, 4]);
          g.strokeStyle = C.signal;
          g.beginPath();
          g.moveTo(0, yPoc);
          g.lineTo(plotW, yPoc);
          g.stroke();
          g.setLineDash([]);
          g.fillStyle = C.signal;
          g.fillText("POC (visible range)", 8, yPoc - 9);
        }
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
        const py = y(o.low);
        if (px === null || py === null) continue;
        tag(px, py + 16, `${o.tf} ${SHORT[o.type]}`, TF_COLOR[o.tf] ?? C.muted);
      }
    }

    if (ly.pattern && sel) {
      const color = TF_COLOR[sel.tf] ?? C.fg;
      const barW = ts.options().barSpacing;
      // Source candles wider than one view bar (e.g. 4h on 1h) are shaded as blocks.
      for (const b of sel.blocks) {
        const x1 = x(b.from);
        const x2 = x(b.to);
        if (x1 === null || x2 === null || x2 - x1 < barW * 1.5) continue;
        g.fillStyle = "rgba(76,154,255,0.10)";
        g.fillRect(x1, 0, x2 - x1, h);
        g.setLineDash([3, 3]);
        g.strokeStyle = "rgba(76,154,255,0.45)";
        g.strokeRect(x1 + 0.5, 0.5, x2 - x1 - 1, h - 1);
        g.setLineDash([]);
      }
      g.strokeStyle = color;
      g.lineWidth = 2;
      if (sel.type === "doubleBottom" && sel.points.length >= 3) {
        g.beginPath();
        sel.points.forEach((p, k) => {
          const px = x(p.x);
          const py = y(p.price);
          if (px === null || py === null) return;
          if (k === 0) g.moveTo(px, py);
          else g.lineTo(px, py);
        });
        g.stroke();
        const n1 = x(sel.points[0].x);
        const n2 = x(sel.entryX);
        const yn = sel.neckline != null ? y(sel.neckline) : null;
        if (n1 !== null && n2 !== null && yn !== null) {
          g.setLineDash([4, 4]);
          g.beginPath();
          g.moveTo(n1, yn);
          g.lineTo(n2, yn);
          g.stroke();
          g.setLineDash([]);
          g.fillStyle = color;
          g.fillText(`${sel.tf} neckline`, n1 + 4, yn - 10);
        }
      } else {
        const last = sel.blocks[sel.blocks.length - 1];
        const x1 = x(last.from);
        const x2 = x(last.to);
        const yHigh = y(sel.high);
        const yLow = y(sel.low);
        if (x1 !== null && x2 !== null && yHigh !== null && yLow !== null) {
          const pad = Math.max(0, (barW * 1.4 - (x2 - x1)) / 2);
          g.strokeRect(x1 - pad, yHigh - 6, x2 - x1 + pad * 2, yLow - yHigh + 12);
        }
      }
      // The signal exists only when the source candle closes.
      const ex = x(sel.entryX);
      if (ex !== null) {
        g.setLineDash([]);
        g.lineWidth = 1.5;
        g.beginPath();
        g.moveTo(ex, 18);
        g.lineTo(ex, h);
        g.stroke();
        tag(ex, 10, `${sel.tf} close ✓`, color);
      }
      g.lineWidth = 1;
    }
    g.restore();
  }

  useLayoutEffect(() => {
    drawRef.current = drawOverlay;
  });

  // Data.
  useEffect(() => {
    const s = seriesRef.current;
    const chart = chartRef.current;
    if (!s || !chart) return;
    s.candle.setData(
      candles.map((c) => ({
        time: t(c.openTime),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      })),
    );
    s.volume.setData(
      candles.map((c) => ({
        time: t(c.openTime),
        value: c.volume,
        color: c.close >= c.open ? "rgba(86,211,100,0.35)" : "rgba(244,112,103,0.35)",
      })),
    );
    const closes = candles.map((c) => c.close);
    const e = ema(closes, 50);
    s.ema.setData(
      candles.flatMap((c, i) =>
        Number.isFinite(e[i]) ? [{ time: t(c.openTime), value: e[i] }] : [],
      ),
    );
    const bb = bollingerBands(closes, 20, 2);
    s.bbUpper.setData(
      candles.flatMap((c, i) =>
        Number.isFinite(bb[i]?.upper) ? [{ time: t(c.openTime), value: bb[i].upper }] : [],
      ),
    );
    s.bbLower.setData(
      candles.flatMap((c, i) =>
        Number.isFinite(bb[i]?.lower) ? [{ time: t(c.openTime), value: bb[i].lower }] : [],
      ),
    );
    if (candles.length > 0) {
      chart.timeScale().setVisibleLogicalRange({
        from: Math.max(0, candles.length - 160),
        to: candles.length + 10,
      });
    }
    requestAnimationFrame(() => drawRef.current());
  }, [candles]);

  // Layer visibility.
  useEffect(() => {
    const s = seriesRef.current;
    if (!s) return;
    s.ema.applyOptions({ visible: layers.ema });
    s.bbUpper.applyOptions({ visible: layers.bb });
    s.bbLower.applyOptions({ visible: layers.bb });
    drawRef.current();
  }, [layers]);

  // Redraw the overlay when what it draws changes.
  useEffect(() => {
    requestAnimationFrame(() => drawRef.current());
  }, [zones, others]);

  // Selected setup: plan price lines, history markers, scroll into view.
  useEffect(() => {
    const s = seriesRef.current;
    const chart = chartRef.current;
    if (!s || !chart) return;
    for (const pl of priceLinesRef.current) s.candle.removePriceLine(pl);
    priceLinesRef.current = [];
    const ms: SeriesMarker<Time>[] = markers
      .filter((m) => m.result !== "open" || m.current)
      .map((m) => ({
        time: t(m.time),
        position: "belowBar" as const,
        shape: "arrowUp" as const,
        color: m.result === "win" ? C.up : m.result === "loss" ? C.down : C.muted,
        text: m.current ? "now" : m.result === "win" ? "W" : m.result === "loss" ? "L" : "–",
      }))
      .sort((a, b) => (a.time as number) - (b.time as number));
    s.markers.setMarkers(layers.pattern ? ms : []);
    if (selected && plan && layers.pattern) {
      const add = (priceValue: number, color: string, title: string, style: LineStyle) =>
        priceLinesRef.current.push(
          s.candle.createPriceLine({
            price: priceValue,
            color,
            title,
            lineStyle: style,
            lineWidth: 1,
            axisLabelVisible: true,
          }),
        );
      add(plan.target, C.up, "Target", LineStyle.Dashed);
      add(plan.entry, C.signal, "Entry", LineStyle.Solid);
      add(plan.stop, C.down, "Stop", LineStyle.Dashed);
      const len = propsRef.current.candles.length;
      const span = Math.max(110, selected.entryX - selected.startX + 40);
      chart.timeScale().setVisibleLogicalRange({
        from: Math.max(0, selected.startX - (span - (selected.entryX - selected.startX)) * 0.7),
        to: Math.min(len + 10, selected.entryX + 50),
      });
    }
    requestAnimationFrame(() => drawRef.current());
  }, [selected, plan, markers, layers.pattern]);

  return (
    <div className={styles.chartArea}>
      <div ref={boxRef} className={styles.chartBox} />
      <canvas ref={overlayRef} className={styles.overlay} aria-hidden="true" />
    </div>
  );
};

export default PriceChart;
