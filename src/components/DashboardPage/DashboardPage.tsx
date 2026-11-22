import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { RESEARCH_UNIVERSE } from "../../services/HistoryService";
import { MarketDataService } from "../../services/MarketDataService";
import { useUniverseCandles } from "../../custom-hooks/useUniverseCandles";
import { useCatalog, useScanner } from "../../custom-hooks/useAnalysisApi";
import { useLivePrice } from "../../custom-hooks/useLivePrice";
import { loadWatchlist } from "../../utils/watchlistStorage";
import { patternLabel } from "../../utils/patternLabels";
import { loadDetection, pickedKeys, pickKey } from "../../utils/detectionConfig";
import { price, signedPct } from "../../utils/format";
import type { Candle } from "../../types/marketData";
import type { SetupOccurrence } from "../../types/analysis";
import { Chip, Explain } from "../../common-components/Evidence";
import MarketOverview from "../MarketOverview";
import styles from "./DashboardPage.module.scss";

const INTERVAL = "4h" as const;
const SPARK = 42; // 7 days of 4h candles

/** Setups meeting at least this many checklist items are called out in the band. */
const STRONG = 4;
/** Short names of the checklist items for the table. */
const CHECK_SHORT: Record<string, string> = {
  location: "level",
  rsi: "RSI",
  volume: "volume",
  vwap: "VWAP",
  atr: "ATR",
  supertrend: "Supertrend",
};

/** Header band with a three-layer parallax, disabled under reduced motion. */
function Band({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const layers = Array.from(el.querySelectorAll<HTMLElement>("[data-depth]"));
    let mx = 0;
    let my = 0;
    let raf = 0;
    const paint = () => {
      raf = 0;
      for (const l of layers) {
        const d = Number(l.dataset.depth);
        l.style.transform = `translate3d(${mx * d * 22}px, ${window.scrollY * d * 0.35 + my * d * 16}px, 0)`;
      }
    };
    const req = () => {
      if (!raf) raf = requestAnimationFrame(paint);
    };
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      mx = (e.clientX - r.left) / r.width - 0.5;
      my = (e.clientY - r.top) / r.height - 0.5;
      req();
    };
    const leave = () => {
      mx = 0;
      my = 0;
      req();
    };
    window.addEventListener("scroll", req, { passive: true });
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerleave", leave);
    return () => {
      window.removeEventListener("scroll", req);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerleave", leave);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);
  return (
    <section ref={ref} className={styles.band} aria-labelledby="band-title">
      <div className={styles.pxContour} data-depth="0.5" />
      <div className={styles.pxDots} data-depth="0.18" />
      {children}
    </section>
  );
}

function Spark({ candles }: { candles: Candle[] }) {
  const pts = candles.slice(-SPARK).map((c) => c.close);
  if (pts.length < 2) return <div className={styles.sparkEmpty} />;
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const up = pts[pts.length - 1] >= pts[0];
  const color = up ? "var(--t-up)" : "var(--t-down)";
  const coords = pts.map(
    (v, i) =>
      `${((i / (pts.length - 1)) * 200).toFixed(1)},${(32 - ((v - min) / (max - min || 1)) * 28).toFixed(1)}`,
  );
  return (
    <svg viewBox="0 0 200 36" preserveAspectRatio="none" aria-hidden="true">
      <polygon points={`0,36 ${coords.join(" ")} 200,36`} fill={color} fillOpacity="0.12" />
      <polyline
        points={coords.join(" ")}
        fill="none"
        stroke={color}
        strokeWidth="2"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function Tile({ symbol, candles }: { symbol: string; candles: Candle[] }) {
  const live = useLivePrice("BINANCE", symbol, "FUT").price;
  const last = candles[candles.length - 1];
  const now = live ?? last?.close;
  const weekAgo = candles[Math.max(0, candles.length - SPARK)]?.close;
  const change = now != null && weekAgo ? ((now - weekAgo) / weekAgo) * 100 : null;
  return (
    <Link className={styles.tile} to={`/chart/${symbol}`}>
      <div className={styles.tileTop}>
        <b>{symbol}</b>
        {live != null ? <Chip tone="up">Live</Chip> : <Chip tone="lock">Last close</Chip>}
      </div>
      <span className={styles.tilePx}>{now != null ? price(now) : "—"}</span>
      <Spark candles={candles} />
      <div className={styles.tileMeta}>
        <span className={change == null ? "" : change >= 0 ? styles.up : styles.down}>
          {change == null ? "—" : `${change >= 0 ? "▲" : "▼"} ${signedPct(change, 2)}`}
        </span>
        <span>7 days · perp</span>
      </div>
    </Link>
  );
}

const DashboardPage: React.FC = () => {
  const watchlist = useMemo(() => loadWatchlist(), []);
  const universe = useMemo(() => [...new Set([...watchlist, ...RESEARCH_UNIVERSE])], [watchlist]);
  const [attempt, setAttempt] = useState(0);
  const { candles, failed } = useUniverseCandles(universe, INTERVAL, attempt);
  // Levels (zones, order blocks) from the pattern's own timeframe.
  const zoneTf = INTERVAL;
  const catalog = useCatalog().data;
  const scanner = useScanner(INTERVAL, zoneTf, watchlist);
  const ready = scanner.data !== null;
  const serviceError = scanner.error;

  useEffect(() => {
    MarketDataService.getInstance().startMarketData(watchlist);
  }, [watchlist]);

  // The patterns picked in the chart's Patterns panel (chart patterns by default).
  const picked = useMemo(() => pickedKeys(loadDetection(), catalog), [catalog]);
  // The scanner lists the most checks met first.
  const current: SetupOccurrence[] = useMemo(
    () =>
      (scanner.data?.items ?? [])
        .filter((i) => picked.has(pickKey(i.occurrence.pattern, i.occurrence.direction)))
        .map((i) => ({ ...i.occurrence, symbol: i.symbol })),
    [scanner.data, picked],
  );
  const strong = current.filter((o) => o.score >= STRONG).length;
  const top = current[0];
  const patternCount = picked.size;

  return (
    <main className={styles.page}>
      <div className={styles.pagehead}>
        <div>
          <h1>Dashboard</h1>
          <p>Market overview for the 10 research coins, then setups detected now.</p>
        </div>
      </div>

      <MarketOverview candles={candles} />

      <Band>
        <span className={styles.lbl}>
          Scanner · {patternCount || "…"} patterns × {universe.length} coins · {INTERVAL}
        </span>
        <h2 id="band-title">
          {!ready
            ? serviceError
              ? "The analysis service is offline."
              : `Scanning ${universe.length} coins…`
            : current.length === 0
              ? "No setups on the last 3 closed candles."
              : `${current.length} setup${current.length === 1 ? "" : "s"} on the last 3 closed candles. ${strong} meet ${STRONG} or more of 6 checks.`}
        </h2>
        <p>
          {!ready
            ? (serviceError ?? "Detecting patterns on the latest closed candles of every coin…")
            : top
              ? `${top.symbol} printed a ${top.direction === "long" ? "bullish" : "bearish"} ${patternLabel(top.pattern).toLowerCase()} meeting ${top.score} of ${top.checks.length} checks: ${
                  top.checks
                    .filter((c) => c.passed)
                    .map((c) => c.label.toLowerCase())
                    .join("; ") || "none"
                }.`
              : "The scanner re-checks at every candle close."}
        </p>
        <div className={styles.kpis}>
          <div>
            <span className={styles.lbl}>Setups now</span>
            <span className={styles.num}>{ready ? current.length : "…"}</span>
          </div>
          <div>
            <span className={styles.lbl}>{STRONG}+ checks</span>
            <span className={`${styles.num} ${styles.up}`}>{ready ? strong : "…"}</span>
          </div>
          <div>
            <span className={styles.lbl}>Patterns watched</span>
            <span className={styles.num}>{patternCount || "…"}</span>
          </div>
          <div>
            <span className={styles.lbl}>Coins</span>
            <span className={styles.num}>{universe.length}</span>
          </div>
        </div>
      </Band>

      {failed.length > 0 && (
        <div className={styles.alert} role="alert">
          <span>
            Couldn't load chart history for {failed.join(", ")} (sparklines and the market
            overview). Binance's public API must be reachable from this browser.
          </span>
          <button type="button" className={styles.btn} onClick={() => setAttempt((a) => a + 1)}>
            Try again
          </button>
        </div>
      )}

      <div className={styles.grid}>
        <section
          className={`${styles.card} ${styles.feature} ${styles.s8}`}
          aria-labelledby="now-title"
        >
          <div className={styles.cardHead}>
            <h2 id="now-title">Setups detected now</h2>
            <Explain title="What counts as a setup">
              A pattern you picked on the chart (double bottom, flag, triangle…) in a direction,
              confirmed on one of the last 3 closed {INTERVAL} candles. Checks: at an order block or
              zone, RSI in the healthy band, a volume spike, the right side of VWAP, expanding ATR
              and Supertrend agreeing. The count describes the context; it is not a probability.
            </Explain>
            <p>Picked patterns on a recent closed candle, the most checks met first.</p>
          </div>
          <div className={styles.xs}>
            <table className={styles.tbl}>
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Setup</th>
                  <th className={styles.r}>Checks</th>
                  <th>Met</th>
                  <th>
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {current.slice(0, 15).map((o) => (
                  <tr key={`${o.symbol}${o.pattern}${o.direction}${o.time}`}>
                    <td>
                      <b>{o.symbol}</b>
                    </td>
                    <td>
                      <span className={o.direction === "long" ? styles.up : styles.down}>
                        {o.direction === "long" ? "▲" : "▼"}
                      </span>{" "}
                      {patternLabel(o.pattern)}
                    </td>
                    <td className={`${styles.r} ${styles.num}`}>
                      {o.score}/{o.checks.length}
                    </td>
                    <td className={styles.mute}>
                      {o.checks
                        .filter((c) => c.passed)
                        .map((c) => CHECK_SHORT[c.id] ?? c.id)
                        .join(" · ") || "—"}
                    </td>
                    <td>
                      <Link className={styles.btnSm} to={`/chart/${o.symbol}`}>
                        Chart
                      </Link>
                    </td>
                  </tr>
                ))}
                {ready && current.length === 0 && (
                  <tr>
                    <td colSpan={5} className={styles.mute}>
                      Nothing confirmed on the last 3 closed {INTERVAL} candles.
                    </td>
                  </tr>
                )}
                {!ready && (
                  <tr>
                    <td colSpan={5} className={styles.mute}>
                      {serviceError ?? "Scanning…"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className={`${styles.card} ${styles.s4}`} aria-labelledby="pipe-title">
          <div className={styles.cardHead}>
            <h2 id="pipe-title">From pattern to confirmation</h2>
          </div>
          <ol className={styles.pipe}>
            <li>
              <span className={styles.mkOk}>✓</span>
              <span>Market data · {INTERVAL} history</span>
              <Chip tone="up">Live</Chip>
            </li>
            <li>
              <span className={styles.mkOk}>✓</span>
              <span>Indicators &amp; volume levels</span>
              <Chip tone="up">Live</Chip>
            </li>
            <li>
              <span className={styles.mkOk}>✓</span>
              <span>Pattern &amp; zone detection</span>
              <Chip tone="up">Live</Chip>
            </li>
            <li>
              <span className={styles.mkOk}>✓</span>
              <span>Setup checklist (6 checks)</span>
              <Chip tone="up">Live</Chip>
            </li>
            <li>
              <span className={styles.mkNo}>5</span>
              <span>Backtest with fees, out-of-sample</span>
              <Chip tone="lock">P2</Chip>
            </li>
            <li>
              <span className={styles.mkNo}>6</span>
              <span>Forward test (paper)</span>
              <Chip tone="lock">P4</Chip>
            </li>
            <li>
              <span className={styles.mkNo}>7</span>
              <span>News window + risk veto</span>
              <Chip tone="lock">P5–6</Chip>
            </li>
            <li>
              <span className={styles.mkNo}>8</span>
              <span>
                <b>Confirmation</b>
              </span>
              <Chip tone="lock">P6</Chip>
            </li>
          </ol>
        </section>
      </div>

      <section className={styles.card} aria-labelledby="watch-title">
        <div className={styles.cardHead}>
          <h2 id="watch-title">Watchlist</h2>
          <p>
            Live perp price when the stream is connected, otherwise the last closed candle. Open a
            card for its chart.
          </p>
        </div>
        <div className={styles.tiles}>
          {watchlist.map((s) => (
            <Tile key={s} symbol={s} candles={candles.get(s) ?? []} />
          ))}
        </div>
      </section>
    </main>
  );
};

export default DashboardPage;
