import { useState } from "react";
import { VERDICT_LABEL, MEANINGFUL, type Row } from "../../utils/research";
import styles from "./ResearchPage.module.scss";

const ROW_H = 30;
const LABEL_W = 210;
const PAD_R = 36;

/**
 * Effect per ingredient (a dot at the mean move in ATR) with its 95% range (thick) and the range
 * adjusted for every test run at once (thin). Zero is "no information"; the shaded band is the
 * cost of a round trip, either way: an effect has to clear it to be tradeable.
 */
export function EffectChart({ rows, cost, width }: { rows: Row[]; cost: number; width: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const plotW = Math.max(120, width - LABEL_W - PAD_R);
  const ends = rows.flatMap((r) => [r.result.all.lowAdj, r.result.all.highAdj]);
  const reach = Math.max(cost * 1.5, ...ends.map(Math.abs), 0.05);
  const x = (v: number) => LABEL_W + ((v + reach) / (2 * reach)) * plotW;
  const h = rows.length * ROW_H + 28;
  const ticks = [-reach, -reach / 2, 0, reach / 2, reach].map((t) => Number(t.toFixed(3)));
  return (
    <svg
      className={styles.chart}
      width={width}
      height={h}
      viewBox={`0 0 ${width} ${h}`}
      role="img"
      aria-label="Effect of each ingredient with its range; see the table below for the numbers"
    >
      <rect
        className={styles.costBand}
        x={x(-cost)}
        y={0}
        width={x(cost) - x(-cost)}
        height={rows.length * ROW_H}
      />
      <line className={styles.zero} x1={x(0)} x2={x(0)} y1={0} y2={rows.length * ROW_H} />
      {ticks.map((t) => (
        <text
          key={t}
          className={styles.tick}
          x={x(t)}
          y={rows.length * ROW_H + 16}
          textAnchor="middle"
        >
          {t > 0 ? "+" : ""}
          {t}
        </text>
      ))}
      {rows.map((r, i) => {
        const a = r.result.all;
        const y = i * ROW_H + ROW_H / 2;
        const strong = MEANINGFUL.includes(r.result.verdict);
        return (
          <g
            key={r.ingredient.id}
            className={`${styles.row} ${strong ? styles.strong : ""} ${hover === i ? styles.hover : ""}`}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          >
            <rect className={styles.hit} x={0} y={i * ROW_H} width={width} height={ROW_H} />
            <text
              className={styles.label}
              x={LABEL_W - 10}
              y={y}
              textAnchor="end"
              dominantBaseline="middle"
            >
              {r.ingredient.label}
            </text>
            <line className={styles.adj} x1={x(a.lowAdj)} x2={x(a.highAdj)} y1={y} y2={y} />
            <line className={styles.ci} x1={x(a.low)} x2={x(a.high)} y1={y} y2={y} />
            <circle className={styles.dot} cx={x(a.meanAtr)} cy={y} r={5} />
            <title>
              {`${r.ingredient.label}: ${a.meanAtr >= 0 ? "+" : ""}${a.meanAtr.toFixed(3)} ATR per signal (95% ${a.low.toFixed(3)} to ${a.high.toFixed(3)}; adjusted ${a.lowAdj.toFixed(3)} to ${a.highAdj.toFixed(3)}), ${a.n} signals, cost ${a.costAtr.toFixed(3)} ATR. ${VERDICT_LABEL[r.result.verdict]}.`}
            </title>
          </g>
        );
      })}
    </svg>
  );
}
