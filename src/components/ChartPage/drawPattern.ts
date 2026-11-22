/**
 * Draws the selected pattern the way charting tools do: shaded formation, neckline or
 * trendlines, labelled key points and the breakout marker, with the setup checklist score
 * ("4/6") faint beside the name. No trade plan is drawn.
 * Geometry comes from `utils/patternGeometry.ts`; this file only paints it.
 */
import type { Candle } from "../../types/marketData";
import { candleSpan, isChartPattern, patternFigure, type Pt } from "../../utils/patternGeometry";
import type { ViewPattern } from "../../utils/timeframeMapping";

const UP = "86,211,100";
const DOWN = "244,112,103";
const INK = "#0B0F14";

type XFn = (logical: number) => number | null;
type YFn = (price: number) => number | null;

/** A quiet tag: see-through tint, coloured text, thin outline (pattern names, key points). */
function softPill(
  g: CanvasRenderingContext2D,
  px: number,
  py: number,
  text: string,
  rgb: string,
  align: "center" | "left" | "right" = "center",
) {
  g.font = "10px JetBrains Mono, monospace";
  const tw = g.measureText(text).width + 10;
  const left = align === "center" ? px - tw / 2 : align === "right" ? px - tw : px;
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
) {
  const long = vp.direction === "long";
  const rgb = long ? UP : DOWN;
  const score = `${vp.score}/${vp.checks.length}`;
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
    if (fig.height) {
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
    for (const l of fig.labels) {
      const m = map(l.at);
      if (m) softPill(g, m[0], m[1] + (l.side === "below" ? 14 : -14), l.text, rgb);
    }
    // 6. Name tag beyond the formation.
    const sx = x(fig.span.x);
    const sy = y(long ? fig.span.high : fig.span.low);
    if (sx !== null && sy !== null) {
      softPill(
        g,
        sx,
        sy + (long ? -14 : 14),
        `${long ? "▲" : "▼"} ${name} · ${score} checks`,
        rgb,
        "left",
      );
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
      // The checklist score sits faintly in a band above the candles inside the box; the box
      // never widens for it (that would cover other candles), so on narrow boxes it sits above.
      const pad = Math.max(0, (barW * 1.4 - (x2 - x1)) / 2);
      const boxW = x2 - x1 + pad * 2;
      const sub = "checks";
      g.font = "600 14px Inter, system-ui, sans-serif";
      const valueW = g.measureText(score).width + 6;
      g.font = "9px Inter, system-ui, sans-serif";
      const subW = g.measureText(sub).width + 6;
      const inside = boxW >= valueW;
      const head = !inside ? 0 : boxW >= subW ? 30 : 18;
      const top = yHigh - 6 - head;
      g.fillStyle = `rgba(${rgb},0.14)`;
      g.fillRect(x1 - pad, top, boxW, yLow - top + 6);
      g.strokeStyle = solid;
      g.lineWidth = 1.5;
      g.strokeRect(x1 - pad, top, boxW, yLow - top + 6);
      const cx = (x1 + x2) / 2;
      {
        g.save();
        g.textAlign = "center";
        g.textBaseline = "alphabetic";
        g.fillStyle = "rgba(230,237,243,0.45)";
        g.font = "600 14px Inter, system-ui, sans-serif";
        const vy = inside ? top + 17 : top - 6;
        g.fillText(score, cx, vy);
        if (head === 30) {
          g.font = "9px Inter, system-ui, sans-serif";
          g.fillStyle = "rgba(230,237,243,0.38)";
          g.fillText(sub, cx, top + 27);
        }
        g.restore();
      }
      const above = inside ? top : top - 20;
      softPill(g, cx, long ? yLow + 20 : above - 14, `${long ? "▲" : "▼"} ${name}`, rgb);
    }
  }
  g.restore();
}
