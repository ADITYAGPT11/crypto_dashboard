/**
 * Draws a pattern the way charting tools do: shaded formation, neckline or trendlines, labelled
 * key points, the breakout marker and its name. The selected pattern is drawn in full; the other
 * listed patterns in view are drawn `faint` (shape and name only). No score and no trade plan:
 * the checklist lives in the list under the chart.
 * Geometry comes from `utils/patternGeometry.ts`; this file only paints it.
 */
import type { Candle } from "../../types/marketData";
import { candleSpan, isChartPattern, patternFigure, type Pt } from "../../utils/patternGeometry";
import type { ViewPattern } from "../../utils/timeframeMapping";
import { freeOffset, type Rect } from "../../utils/labelPlacement";

const UP = "86,211,100";
const DOWN = "244,112,103";
const INK = "#0B0F14";

type XFn = (logical: number) => number | null;
type YFn = (price: number) => number | null;

type Align = "center" | "left" | "right";

/**
 * The labels of one chart redraw: the selected pattern's are drawn at once and reserve their
 * space; the faint patterns' names are queued and placed afterwards around them (nudged up or
 * down, or left out), so labels never pile on top of each other.
 */
export interface LabelLayer {
  placed: Rect[];
  queued: { px: number; py: number; text: string; rgb: string; align: Align; away: 1 | -1 }[];
  top: number;
  bottom: number;
}

export function labelLayer(top: number, bottom: number): LabelLayer {
  return { placed: [], queued: [], top, bottom };
}

/** Box a soft pill occupies. */
function pillRect(g: CanvasRenderingContext2D, px: number, py: number, text: string, align: Align) {
  g.font = "10px JetBrains Mono, monospace";
  const tw = g.measureText(text).width + 10;
  const left = align === "center" ? px - tw / 2 : align === "right" ? px - tw : px;
  return { x: left, y: py - 7.5, w: tw, h: 16 };
}

/** Place and draw the queued faint names, newest first; those with no free spot are left out. */
export function flushLabels(g: CanvasRenderingContext2D, layer: LabelLayer) {
  g.save();
  g.globalAlpha = 0.4;
  for (const q of layer.queued) {
    const r = pillRect(g, q.px, q.py, q.text, q.align);
    const dy = freeOffset(r, layer.placed, layer, q.away);
    if (dy === null) continue;
    layer.placed.push({ ...r, y: r.y + dy });
    softPill(g, q.px, q.py + dy, q.text, q.rgb, q.align);
  }
  g.restore();
  layer.queued = [];
}

/** A quiet tag: see-through tint, coloured text, thin outline (pattern names, key points). */
function softPill(
  g: CanvasRenderingContext2D,
  px: number,
  py: number,
  text: string,
  rgb: string,
  align: Align = "center",
) {
  const { x: left, w: tw } = pillRect(g, px, py, text, align);
  g.beginPath();
  g.roundRect(left + 0.5, py - 7.5, tw, 16, 4);
  g.fillStyle = `rgba(${rgb},0.14)`;
  g.fill();
  g.strokeStyle = `rgba(${rgb},0.35)`;
  g.lineWidth = 1;
  g.stroke();
  g.fillStyle = `rgba(${rgb},0.9)`;
  g.fillText(text, left + 5, py + 0.5);
}

export function drawPattern(
  g: CanvasRenderingContext2D,
  vp: ViewPattern,
  name: string,
  candles: readonly Candle[],
  x: XFn,
  y: YFn,
  barW: number,
  faint = false,
  layer: LabelLayer | null = null,
) {
  const long = vp.direction === "long";
  // Labels: the selected pattern's are drawn now and reserve space; faint names wait for
  // `flushLabels`. `away` is the nudge direction away from the shape (−1 = up).
  const label = (px: number, py: number, text: string, align: Align, away: 1 | -1) => {
    if (faint) {
      layer?.queued.push({ px, py, text, rgb, align, away });
      return;
    }
    layer?.placed.push(pillRect(g, px, py, text, align));
    softPill(g, px, py, text, rgb, align);
  };
  const rgb = long ? UP : DOWN;
  const solid = `rgb(${rgb})`;
  const map = (p: Pt): [number, number] | null => {
    const px = x(p.x);
    const py = y(p.price);
    return px === null || py === null ? null : [px, py];
  };
  const path = (pts: Pt[]) => {
    g.beginPath();
    let started = false;
    for (const p of pts) {
      const m = map(p);
      if (!m) continue;
      if (started) g.lineTo(m[0], m[1]);
      else g.moveTo(m[0], m[1]);
      started = true;
    }
    return started;
  };

  g.save();
  if (faint) g.globalAlpha = 0.4;
  g.lineJoin = "round";
  g.lineCap = "round";

  g.font = "11px JetBrains Mono, monospace";
  if (isChartPattern(vp)) {
    const fig = patternFigure(vp);
    // 2. Formation: shaded, outlined.
    if (fig.fill.length >= 3 && path(fig.fill)) {
      g.closePath();
      g.fillStyle = `rgba(${rgb},0.16)`;
      g.fill();
    }
    for (const s of fig.strokes) {
      if (!path(s.pts)) continue;
      g.lineWidth = s.width;
      g.strokeStyle = s.faint ? `rgba(${rgb},0.45)` : solid;
      g.setLineDash(s.dashed ? [5, 4] : []);
      g.stroke();
    }
    g.setLineDash([]);
    g.fillStyle = solid;
    for (const d of fig.dots) {
      const m = map(d);
      if (!m) continue;
      g.beginPath();
      g.arc(m[0], m[1], 3, 0, Math.PI * 2);
      g.fill();
    }
    // 3. Pattern height inside the formation.
    if (fig.height && !faint) {
      const a = map(fig.height.from);
      const b = map(fig.height.to);
      if (a && b) {
        g.strokeStyle = `rgba(${rgb},0.8)`;
        g.lineWidth = 1;
        g.setLineDash([2, 3]);
        g.beginPath();
        g.moveTo(a[0], a[1]);
        g.lineTo(b[0], b[1]);
        g.stroke();
        g.setLineDash([]);
      }
    }
    // 5. Key-point tags.
    for (const l of faint ? [] : fig.labels) {
      const m = map(l.at);
      if (m) label(m[0], m[1] + (l.side === "below" ? 14 : -14), l.text, "center", 1);
    }
    // 6. Name tag beyond the formation.
    const sx = x(fig.span.x);
    const sy = y(long ? fig.span.high : fig.span.low);
    if (sx !== null && sy !== null) {
      label(sx, sy + (long ? -14 : 14), `${long ? "▲" : "▼"} ${name}`, "left", long ? -1 : 1);
    }
    // 7. Breakout marker on the confirmation close.
    const bm = map(fig.breakout);
    if (bm) {
      g.fillStyle = INK;
      g.strokeStyle = solid;
      g.lineWidth = 2;
      g.beginPath();
      g.arc(bm[0], bm[1], 4.5, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
  } else {
    // Candlestick patterns: a box around their own candles (not the confirmation) and the name.
    const { from, to } = candleSpan(vp);
    const x1 = x(from);
    const x2 = x(to);
    const i0 = Math.max(0, Math.round(from + 0.5));
    const i1 = Math.min(candles.length - 1, Math.round(to - 0.5));
    const span = candles.slice(i0, i1 + 1);
    const yHigh = span.length ? y(Math.max(...span.map((c) => c.high))) : null;
    const yLow = span.length ? y(Math.min(...span.map((c) => c.low))) : null;
    if (x1 !== null && x2 !== null && yHigh !== null && yLow !== null) {
      const pad = Math.max(0, (barW * 1.4 - (x2 - x1)) / 2);
      const top = yHigh - 6;
      g.fillStyle = `rgba(${rgb},0.14)`;
      g.fillRect(x1 - pad, top, x2 - x1 + pad * 2, yLow - top + 6);
      g.strokeStyle = solid;
      g.lineWidth = faint ? 1 : 1.5;
      g.strokeRect(x1 - pad, top, x2 - x1 + pad * 2, yLow - top + 6);
      const cx = (x1 + x2) / 2;
      label(
        cx,
        long ? yLow + 20 : top - 14,
        `${long ? "▲" : "▼"} ${name}`,
        "center",
        long ? 1 : -1,
      );
    }
  }
  g.restore();
}
