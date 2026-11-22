/**
 * How a selected pattern is drawn, in the chart's logical (bar) × price space, after the
 * conventions of TradingView's pattern tools and Bulkowski's illustrations:
 *
 * - the formation as a filled shape (W / M, head and shoulders, triangle, wedge, flag box),
 * - its neckline or trendlines, its key points labelled (B1/B2, T1/T2, LS/H/RS),
 * - the breakout candle, the measured move to the target,
 * - a long / short position box from entry to exit (target green, stop red).
 *
 * Geometry only: every price and time comes from the analysis service; nothing is detected here.
 */
import type { ViewPattern } from "./timeframeMapping";

export interface Pt {
  x: number;
  price: number;
}

export interface Stroke {
  pts: Pt[];
  width: number;
  dashed?: boolean;
  /** Secondary line (a zigzag through the touches): drawn thinner and fainter. */
  faint?: boolean;
}

export interface PointLabel {
  at: Pt;
  text: string;
  side: "above" | "below";
}

export interface Projection {
  from: Pt;
  to: Pt;
  text: string;
}

export interface PatternFigure {
  /** Polygon shaded in the pattern's colour (empty for candlestick patterns). */
  fill: Pt[];
  strokes: Stroke[];
  labels: PointLabel[];
  /** Touches of the trendlines, drawn as small dots. */
  dots: Pt[];
  /** Close of the confirmation candle. */
  breakout: Pt;
  /** Pattern height inside the formation (what the target projects). */
  height: { from: Pt; to: Pt } | null;
  /** The move from the breakout to the target. */
  projection: Projection | null;
  /** Price span the name tag sits beyond (above for longs, below for shorts). */
  span: { x: number; high: number; low: number };
}

export interface PositionBox {
  x1: number;
  x2: number;
  entry: number;
  target: number;
  stop: number;
  /** Reward over risk at entry; ≤ 0 when the target was already behind entry. */
  rr: number;
  targetPct: number;
  stopPct: number;
  /** Where the trade was closed by its stop (trailed or not): the fill; null otherwise. */
  exit: Pt | null;
}

/** Short tags on key points (industry shorthand); unlisted labels are not drawn. */
const SHORT: Record<string, string> = {
  "Bottom 1": "B1",
  "Bottom 2": "B2",
  "Top 1": "T1",
  "Top 2": "T2",
  "Left shoulder": "LS",
  Head: "H",
  "Right shoulder": "RS",
};

const TRIANGLES = new Set(["ascendingTriangle", "descendingTriangle", "symmetricalTriangle"]);
const WEDGES = new Set(["fallingWedge", "risingWedge"]);
const FLAGS = new Set(["bullFlag", "bearFlag"]);

/** Price on the line through `a` and `b` at `x` (flat when a and b share an x). */
function along(a: Pt, b: Pt, x: number): number {
  return b.x === a.x ? a.price : a.price + ((b.price - a.price) * (x - a.x)) / (b.x - a.x);
}

function lineNamed(vp: ViewPattern, label: string): [Pt, Pt] | null {
  const ln = vp.lines.find((l) => l.label === label);
  return ln
    ? [
        { x: ln.x1, price: ln.p1 },
        { x: ln.x2, price: ln.p2 },
      ]
    : null;
}

/** Chart patterns carry key points or lines; candlestick patterns only their candles. */
export function isChartPattern(vp: ViewPattern): boolean {
  return vp.lines.length > 0;
}

export function patternFigure(vp: ViewPattern): PatternFigure {
  const long = vp.direction === "long";
  const last = vp.blocks[vp.blocks.length - 1];
  const bx = last ? (last.from + last.to) / 2 : vp.entryX;
  const breakout = { x: bx, price: vp.entry };
  const labels: PointLabel[] = vp.points
    .filter((p) => SHORT[p.label])
    .map((p) => ({
      at: { x: p.x, price: p.price },
      text: SHORT[p.label],
      side: long ? "below" : "above",
    }));
  const fig: PatternFigure = {
    fill: [],
    strokes: [],
    labels,
    dots: [],
    breakout,
    height: null,
    projection: null,
    span: { x: vp.startX, high: vp.entry, low: vp.entry },
  };
  const neck = lineNamed(vp, "Neckline");
  const upper = lineNamed(vp, "Upper");
  const lower = lineNamed(vp, "Lower");
  const flagLine = lineNamed(vp, "Flag high") ?? lineNamed(vp, "Flag low");
  const pts = vp.points.map((p) => ({ x: p.x, price: p.price }));

  if (neck && pts.length >= 3) {
    // Double bottom / top, (inverse) head and shoulders: the W / M path from the neckline,
    // through the key points, back to the neckline at the breakout; the area between is shaded.
    const [a, b] = neck;
    const x0 = pts[0].x - (pts[1].x - pts[0].x) * 0.5;
    const n0 = { x: x0, price: along(a, b, x0) };
    const nb = { x: bx, price: along(a, b, bx) };
    const path = [n0, ...pts, nb];
    fig.fill = path;
    fig.strokes.push({ pts: path, width: 2 });
    fig.strokes.push({ pts: [n0, nb], width: 1.5 });
    fig.strokes.push({
      pts: [nb, { x: vp.entryX + 4, price: along(a, b, vp.entryX + 4) }],
      width: 1.5,
      dashed: true,
    });
    const ext = pts.reduce((m, p) =>
      long ? (p.price < m.price ? p : m) : p.price > m.price ? p : m,
    );
    fig.height = { from: ext, to: { x: ext.x, price: along(a, b, ext.x) } };
    fig.projection = { from: nb, to: { x: nb.x, price: vp.target }, text: "Measured move" };
  } else if (upper && lower) {
    // Triangles and wedges: the two trendlines from the formation's start to the breakout,
    // the area between shaded, the swing touches as dots and a faint zigzag through them.
    const [ua, ub] = upper;
    const [la, lb] = lower;
    fig.fill = [ua, ub, lb, la];
    fig.strokes.push({ pts: [ua, ub], width: 2 });
    fig.strokes.push({ pts: [la, lb], width: 2 });
    fig.strokes.push({ pts, width: 1, faint: true });
    fig.dots = pts;
    if (TRIANGLES.has(vp.pattern)) {
      fig.height = { from: la, to: ua };
      fig.projection = {
        from: breakout,
        to: { x: bx, price: vp.target },
        text: "Height at start",
      };
    } else if (WEDGES.has(vp.pattern)) {
      fig.projection = {
        from: breakout,
        to: { x: bx, price: vp.target },
        text: "Back to wedge start",
      };
    }
  } else if (flagLine && FLAGS.has(vp.pattern) && pts.length >= 3) {
    // Flags: the pole as a thick line, the pause as a box from its high to its low.
    const [pole, tip, pause] = pts;
    fig.strokes.push({ pts: [pole, tip], width: 3 });
    const top = { x: tip.x, price: flagLine[0].price };
    const box = [
      top,
      { x: bx, price: top.price },
      { x: bx, price: pause.price },
      { x: tip.x, price: pause.price },
    ];
    fig.fill = box;
    fig.strokes.push({ pts: [...box, top], width: 1.5 });
    fig.projection = {
      from: breakout,
      to: { x: bx, price: vp.target },
      text: "Pole length",
    };
  }
  const prices = [vp.entry, ...fig.fill.map((p) => p.price), ...pts.map((p) => p.price)];
  fig.span = {
    x: fig.fill.length ? Math.min(...fig.fill.map((p) => p.x)) : vp.startX,
    high: Math.max(...prices),
    low: Math.min(...prices),
  };
  return fig;
}

/**
 * View range of a candlestick pattern's own candles: its first candle to its last key point.
 * The confirmation candle that follows is left out (the position box starts at its close),
 * so a two-candle engulfing is boxed as two candles, not three.
 */
export function candleSpan(vp: ViewPattern): { from: number; to: number } {
  const first = vp.blocks[0];
  const lastX = vp.points.length ? Math.max(...vp.points.map((p) => p.x)) : null;
  const last =
    (lastX !== null && vp.blocks.find((b) => b.from <= lastX && lastX <= b.to)) ||
    vp.blocks[vp.blocks.length - 1];
  return { from: Math.min(first.from, vp.startX), to: last.to };
}

/** The trade the pattern proposes, from entry until it resolved (or the outcome window ends). */
export function positionBox(vp: ViewPattern): PositionBox {
  const risk = Math.abs(vp.entry - vp.stop);
  const sign = vp.direction === "long" ? 1 : -1;
  return {
    x1: vp.entryX,
    // The whole outcome window, like a position tool; the actual exit is marked inside it.
    x2: Math.max(vp.entryX + 1, vp.windowEndX),
    entry: vp.entry,
    target: vp.target,
    stop: vp.stop,
    rr: risk > 0 ? ((vp.target - vp.entry) * sign) / risk : 0,
    targetPct: ((vp.target - vp.entry) / vp.entry) * 100,
    stopPct: ((vp.stop - vp.entry) / vp.entry) * 100,
    exit:
      vp.exitX !== null &&
      vp.outcome.exitPrice !== null &&
      (vp.outcome.result === "win" || vp.outcome.result === "loss")
        ? { x: vp.exitX, price: vp.outcome.exitPrice }
        : null,
  };
}
