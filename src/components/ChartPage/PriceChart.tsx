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
import type { Candle } from "../../types/marketData";
import type { SetupOccurrence, Zone } from "../../types/analysis";
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

interface Props {
  candles: Candle[];
  zones: Zone[];
  selected: SetupOccurrence | null;
  /** Past occurrences of the selected setup on this chart (marked W/L). */
  history: SetupOccurrence[];
  layers: Layers;
}

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

const PriceChart: React.FC<Props> = ({ candles, zones, selected, history, layers }) => {
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
  const propsRef = useRef({ candles, zones, selected, layers });
  const drawRef = useRef<() => void>(() => {});
  // Keep the latest props for the imperative overlay (runs before paint, after render).
  useLayoutEffect(() => {
    propsRef.current = { candles, zones, selected, layers };
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
    const { candles: cs, zones: zs, selected: sel, layers: ly } = propsRef.current;
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
    const x = (i: number) => ts.logicalToCoordinate(i as Logical);
    const y = (p: number) => s.candle.priceToCoordinate(p);
    g.save();
    g.beginPath();
    g.rect(0, 0, plotW, h);
    g.clip();
    g.font = "11px JetBrains Mono, monospace";
    g.textBaseline = "middle";

    if (ly.zones) {
      for (const z of zs) {
        const end = z.endIndex ?? cs.length + 12;
        if (end < range.from || z.startIndex > range.to) continue;
        const x1 = x(z.startIndex) ?? 0;
        const x2 = z.endIndex === null ? plotW : (x(end) ?? plotW);
        const yTop = y(z.high);
        const yBot = y(z.low);
        if (yTop === null || yBot === null) continue;
        const demand = z.kind === "demand";
        const intact = z.endIndex === null;
        g.fillStyle = demand
          ? `rgba(86,211,100,${intact ? 0.12 : 0.05})`
          : `rgba(244,112,103,${intact ? 0.1 : 0.04})`;
        g.fillRect(x1, yTop, x2 - x1, yBot - yTop);
        if (intact) {
          g.strokeStyle = demand ? "rgba(86,211,100,0.45)" : "rgba(244,112,103,0.4)";
          g.strokeRect(x1 + 0.5, yTop + 0.5, x2 - x1 - 1, yBot - yTop - 1);
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

    if (ly.pattern && sel) {
      g.strokeStyle = "rgba(230,237,243,0.9)";
      g.lineWidth = 2;
      const hit = sel.hit;
      if (hit.type === "doubleBottom" && hit.points.length >= 4) {
        g.beginPath();
        hit.points.forEach((p, k) => {
          const px = x(p.index);
          const py = y(p.price);
          if (px === null || py === null) return;
          if (k === 0) g.moveTo(px, py);
          else g.lineTo(px, py);
        });
        g.stroke();
        const n1 = x(hit.points[0].index);
        const n2 = x(hit.index);
        const yn = hit.neckline != null ? y(hit.neckline) : null;
        if (n1 !== null && n2 !== null && yn !== null) {
          g.setLineDash([4, 4]);
          g.beginPath();
          g.moveTo(n1, yn);
          g.lineTo(n2, yn);
          g.stroke();
          g.setLineDash([]);
          g.fillStyle = C.fg;
          g.fillText("neckline", n1 + 4, yn - 10);
        }
      } else {
        const px = x(hit.index);
        const yHigh = y(Math.max(cs[hit.index].high, cs[Math.max(0, hit.index - 1)].high));
        const yLow = y(hit.low);
        const half = Math.max(6, ts.options().barSpacing * 1.4);
        if (px !== null && yHigh !== null && yLow !== null) {
          g.strokeRect(px - half, yHigh - 6, half * 2, yLow - yHigh + 12);
        }
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

  // Selected setup: plan price lines, history markers, scroll into view.
  useEffect(() => {
    const s = seriesRef.current;
    const chart = chartRef.current;
    if (!s || !chart) return;
    for (const pl of priceLinesRef.current) s.candle.removePriceLine(pl);
    priceLinesRef.current = [];
    const markers: SeriesMarker<Time>[] = history
      .filter((o) => o.outcome.result !== "open" || o === selected)
      .map((o) => ({
        time: t(o.time),
        position: "belowBar" as const,
        shape: "arrowUp" as const,
        color: o.outcome.result === "win" ? C.up : o.outcome.result === "loss" ? C.down : C.muted,
        text:
          o === selected
            ? "now"
            : o.outcome.result === "win"
              ? "W"
              : o.outcome.result === "loss"
                ? "L"
                : "–",
      }))
      .sort((a, b) => (a.time as number) - (b.time as number));
    s.markers.setMarkers(layers.pattern ? markers : []);
    if (selected && layers.pattern) {
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
      add(selected.hit.target, C.up, "Target", LineStyle.Dashed);
      add(selected.hit.entry, C.signal, "Entry", LineStyle.Solid);
      add(selected.hit.stop, C.down, "Stop", LineStyle.Dashed);
      const i = selected.hit.index;
      const len = propsRef.current.candles.length;
      chart
        .timeScale()
        .setVisibleLogicalRange({ from: Math.max(0, i - 110), to: Math.min(len + 10, i + 50) });
    }
    requestAnimationFrame(() => drawRef.current());
  }, [selected, history, layers.pattern]);

  return (
    <div className={styles.chartArea}>
      <div ref={boxRef} className={styles.chartBox} />
      <canvas ref={overlayRef} className={styles.overlay} aria-hidden="true" />
    </div>
  );
};

export default PriceChart;
