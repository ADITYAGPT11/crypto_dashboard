import { useEffect, useRef, useState } from "react";
import {
  BaselineSeries,
  ColorType,
  CrosshairMode,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { shortDate } from "../../utils/format";
import { usd } from "../../utils/paperAccount";
import styles from "./PaperPage.module.scss";

const token = (name: string, fallback: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

/**
 * The paper account's balance after each closed trade, against the starting balance: above it
 * in green, below in red. Hover for the date and balance.
 */
export function EquityChart({
  points,
  start,
}: {
  points: { time: number; balance: number }[];
  start: number;
}) {
  const box = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const series = useRef<ISeriesApi<"Baseline"> | null>(null);
  const [hover, setHover] = useState<{ time: number; balance: number } | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const up = token("--t-up", "#56D364");
    const down = token("--t-down", "#F47067");
    const c = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: token("--t-muted", "#9AA7B4"),
        fontFamily: "JetBrains Mono, ui-monospace, monospace",
        fontSize: 11,
      },
      grid: { vertLines: { visible: false }, horzLines: { color: "rgba(148,170,200,0.07)" } },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false },
      crosshair: { mode: CrosshairMode.Magnet },
      handleScroll: false,
      handleScale: false,
    });
    const s = c.addSeries(BaselineSeries, {
      lineWidth: 2,
      topLineColor: up,
      bottomLineColor: down,
      topFillColor1: "rgba(86,211,100,0.18)",
      topFillColor2: "rgba(86,211,100,0.02)",
      bottomFillColor1: "rgba(244,112,103,0.02)",
      bottomFillColor2: "rgba(244,112,103,0.18)",
      priceLineVisible: false,
      lastValueVisible: true,
      priceFormat: { type: "price", precision: 0, minMove: 1 },
    });
    c.subscribeCrosshairMove((p) => {
      const d = p.time !== undefined ? p.seriesData.get(s) : undefined;
      const v = d && "value" in d && typeof d.value === "number" ? d.value : null;
      setHover(v === null ? null : { time: (p.time as number) * 1000, balance: v });
    });
    chart.current = c;
    series.current = s;
    return () => {
      c.remove();
      chart.current = null;
      series.current = null;
    };
  }, []);

  useEffect(() => {
    const s = series.current;
    if (!s) return;
    s.applyOptions({ baseValue: { type: "price", price: start } });
    // One point per second at most (trades closing together keep the last balance).
    const byTime = new Map<number, number>();
    for (const p of points) byTime.set(Math.floor(p.time / 1000), p.balance);
    s.setData(
      [...byTime]
        .sort((a, b) => a[0] - b[0])
        .map(([t, v]) => ({ time: t as UTCTimestamp, value: v })),
    );
    chart.current?.timeScale().fitContent();
  }, [points, start]);

  const last = points[points.length - 1];
  const shown = hover ?? last;
  return (
    <div className={styles.equity}>
      <p className={styles.equityLegend} aria-live="polite">
        {shown ? (
          <>
            <span className={styles.mute}>{shortDate(shown.time)}</span>{" "}
            <strong>{usd(shown.balance)}</strong>{" "}
            <span className={shown.balance >= start ? styles.up : styles.down}>
              {usd(shown.balance - start, true)}
            </span>
          </>
        ) : (
          <span className={styles.mute}>No trades to replay yet.</span>
        )}
      </p>
      <div
        ref={box}
        className={styles.equityBox}
        role="img"
        aria-label="Paper account balance over time"
      />
    </div>
  );
}
