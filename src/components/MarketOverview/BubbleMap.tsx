import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { layoutBubbles } from "../../utils/marketStats";
import type { CoinRow } from "../../utils/marketRows";
import { signed } from "./format";
import styles from "./MarketOverview.module.scss";

type Period = "24h" | "7d";
const HEIGHT = 440;

/** Floating bubbles: size = 24h volume, colour = change over the chosen period. */
const BubbleMap: React.FC<{ rows: readonly CoinRow[] }> = ({ rows }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [period, setPeriod] = useState<Period>("24h");

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(280, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const height = width < 560 ? 360 : HEIGHT;
  const bubbles = useMemo(() => {
    // Volume when the ticker is in; otherwise equal sizes from candles alone.
    const weights = rows.map((r) => ({
      id: r.symbol,
      weight: Number.isFinite(r.quoteVolume) && r.quoteVolume > 0 ? r.quoteVolume : 1,
    }));
    return layoutBubbles(weights, width, height);
  }, [rows, width, height]);

  const change = (r: CoinRow) => (period === "24h" ? r.change24h : r.change7d);
  const maxAbs = Math.max(2, ...rows.map((r) => Math.abs(change(r))).filter(Number.isFinite));
  const byId = new Map(rows.map((r) => [r.symbol, r]));

  return (
    <section
      className={`${styles.card} ${styles.feature} ${styles.wide}`}
      aria-labelledby="bub-title"
    >
      <div className={styles.cardHead}>
        <h2 id="bub-title">Market bubbles · {rows.length} coins</h2>
        <div
          className={styles.pills}
          role="group"
          aria-label="Change period"
          style={{ marginLeft: "auto" }}
        >
          {(["24h", "7d"] as const).map((p) => (
            <button
              key={p}
              type="button"
              className={styles.pill}
              aria-pressed={p === period}
              onClick={() => setPeriod(p)}
            >
              {p}
            </button>
          ))}
        </div>
      </div>
      <div ref={ref} className={styles.bubbleBox} style={{ height }}>
        {bubbles.map((b, i) => {
          const r = byId.get(b.id)!;
          const c = change(r);
          const a = Number.isFinite(c) ? Math.min(1, Math.abs(c) / maxAbs) : 0;
          const rgb = c >= 0 ? "86, 211, 100" : "244, 112, 103";
          return (
            <Link
              key={b.id}
              to={`/chart/${b.id}`}
              className={styles.bubble}
              aria-label={`${r.base} ${signed(c)} over ${period}, open chart`}
              style={{
                left: b.x - b.r,
                top: b.y - b.r,
                width: b.r * 2,
                height: b.r * 2,
                borderColor: c >= 0 ? "var(--t-up)" : "var(--t-down)",
                background: `radial-gradient(circle at 35% 30%, rgba(${rgb}, ${(0.22 + 0.45 * a).toFixed(2)}), rgba(${rgb}, ${(0.06 + 0.18 * a).toFixed(2)}) 70%)`,
                animationDuration: `${9 + (i % 4) * 2.5}s`,
                animationDelay: `${-i * 1.3}s`,
              }}
            >
              <b style={{ fontSize: Math.max(12, b.r / 3) }}>{r.base}</b>
              <span style={{ fontSize: Math.max(11, b.r / 4.5) }}>{signed(c)}</span>
            </Link>
          );
        })}
      </div>
      <p className={styles.faint} style={{ marginTop: 10 }}>
        Size = 24h volume (Binance perps) · colour = {period} change · click a bubble for its chart.
        Motion stops when your system asks for reduced motion.
      </p>
    </section>
  );
};

export default BubbleMap;
