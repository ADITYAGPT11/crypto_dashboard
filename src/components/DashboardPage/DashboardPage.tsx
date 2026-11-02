import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { RESEARCH_UNIVERSE } from "../../services/HistoryService";
import { MarketDataService } from "../../services/MarketDataService";
import { useScan } from "../../custom-hooks/useScan";
import { useLivePrice } from "../../custom-hooks/useLivePrice";
import { loadWatchlist } from "../../utils/watchlistStorage";
import { LOCATION_LABELS } from "../../utils/setupAnalysis";
import { PATTERN_LABELS } from "../../utils/patterns";
import { pct, price, signedPct, signedR } from "../../utils/format";
import type { Candle } from "../../types/marketData";
import type { SetupStats } from "../../types/analysis";
import { Chip, CiBar, Explain, VerdictChip } from "../../common-components/Evidence";
import MarketOverview from "../MarketOverview";
import styles from "./DashboardPage.module.scss";

const INTERVAL = "4h" as const;
const SPARK = 42; // 7 days of 4h candles

function setupLabel(s: Pick<SetupStats, "type" | "location">) {
  return `${PATTERN_LABELS[s.type]} · ${LOCATION_LABELS[s.location]}`;
}

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
  const { loading, scan, candles, failed } = useScan(universe, INTERVAL, attempt);

  useEffect(() => {
    MarketDataService.getInstance().startMarketData(watchlist);
  }, [watchlist]);

  const current = scan?.current ?? [];
  const edgeNow = current.filter((c) => c.pooled.verdict === "edge").length;
  const library = useMemo(
    () => (scan ? [...scan.pooled.values()].sort((a, b) => b.n - a.n) : []),
    [scan],
  );
  const tracked = useMemo(
    () => (scan ? [...scan.analyses.values()].reduce((s, a) => s + a.occurrences.length, 0) : 0),
    [scan],
  );
  const coins = candles.size;
  const anyCandles = candles.values().next().value as Candle[] | undefined;
  const days =
    anyCandles && anyCandles.length > 1
      ? Math.round(
          (anyCandles[anyCandles.length - 1].openTime - anyCandles[0].openTime) / 86_400_000,
        )
      : 0;
  const top = current.find((c) => c.pooled.verdict === "edge") ?? current[0];

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
          Scanner · {Object.keys(PATTERN_LABELS).length} patterns × 2 locations × {universe.length}{" "}
          coins · {INTERVAL}
        </span>
        <h2 id="band-title">
          {loading && !scan
            ? `Scanning ${universe.length} coins…`
            : current.length === 0
              ? "No setups on the last 3 closed candles."
              : `${current.length} setup${current.length === 1 ? "" : "s"} on the last 3 closed candles. ${edgeNow} with a measured edge.`}
        </h2>
        <p>
          {loading && !scan
            ? `Loading about 500 days of ${INTERVAL} history per coin from Binance, then measuring every past occurrence.`
            : top
              ? `${top.occurrence.symbol} printed a ${PATTERN_LABELS[top.occurrence.hit.type].toLowerCase()} ${LOCATION_LABELS[top.occurrence.location]}. Across ${top.pooled.n} past cases on ${coins} coins it reached its target ${pct(top.pooled.winRate)} of the time (range ${pct(top.pooled.ci[0])}–${pct(top.pooled.ci[1])}).`
              : "The scanner re-checks at every candle close. Below is how each setup has performed so far."}
        </p>
        <div className={styles.kpis}>
          <div>
            <span className={styles.lbl}>Setups now</span>
            <span className={styles.num}>{scan ? current.length : "…"}</span>
          </div>
          <div>
            <span className={styles.lbl}>Edge candidates</span>
            <span className={`${styles.num} ${styles.up}`}>{scan ? edgeNow : "…"}</span>
          </div>
          <div>
            <span className={styles.lbl}>Patterns measured</span>
            <span className={styles.num}>{scan ? tracked.toLocaleString("en-US") : "…"}</span>
          </div>
          <div>
            <span className={styles.lbl}>History</span>
            <span className={styles.num}>{scan ? `${coins} coins · ${days} d` : "…"}</span>
          </div>
        </div>
      </Band>

      {failed.length > 0 && (
        <div className={styles.alert} role="alert">
          <span>
            Couldn't load history for {failed.join(", ")}.{" "}
            {coins > 0
              ? "Statistics use the coins that loaded."
              : "Binance's public API must be reachable from this browser."}
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
              A pattern (double bottom, bullish engulfing, hammer) plus its location (inside a
              demand zone or in open space), confirmed on one of the last 3 closed {INTERVAL}{" "}
              candles. The win rate is the same setup across every coin's history: target hit before
              stop within 30 candles.
            </Explain>
            <p>
              Pattern + location on a recent closed candle. Statistics pool every past case across
              all coins.
            </p>
          </div>
          <div className={styles.xs}>
            <table className={styles.tbl}>
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Setup</th>
                  <th className={styles.r}>Past n</th>
                  <th className={styles.ciCol}>Win rate · 95% range · break-even</th>
                  <th className={styles.r}>Avg win</th>
                  <th>Verdict</th>
                  <th>
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {current.slice(0, 15).map(({ occurrence: o, pooled: p }) => (
                  <tr key={`${o.symbol}${o.hit.type}${o.hit.index}`}>
                    <td>
                      <b>{o.symbol}</b>
                    </td>
                    <td>
                      {PATTERN_LABELS[o.hit.type]}{" "}
                      <span className={styles.mute}>{LOCATION_LABELS[o.location]}</span>
                    </td>
                    <td className={`${styles.r} ${styles.num}`}>{p.n}</td>
                    <td>
                      <div className={styles.ciCell}>
                        <span className={styles.num}>{pct(p.winRate)}</span>
                        <CiBar stats={p} />
                      </div>
                    </td>
                    <td className={`${styles.r} ${styles.num} ${styles.up}`}>
                      {signedPct(p.avgWinPct)}
                    </td>
                    <td>
                      <VerdictChip verdict={p.verdict} />
                    </td>
                    <td>
                      <Link className={styles.btnSm} to={`/chart/${o.symbol}`}>
                        Chart
                      </Link>
                    </td>
                  </tr>
                ))}
                {scan && current.length === 0 && (
                  <tr>
                    <td colSpan={7} className={styles.mute}>
                      Nothing confirmed on the last 3 closed {INTERVAL} candles. The table below
                      shows how each setup has done.
                    </td>
                  </tr>
                )}
                {!scan && (
                  <tr>
                    <td colSpan={7} className={styles.mute}>
                      Scanning…
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
              <span>Pattern history (gross)</span>
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

      <section className={styles.card} aria-labelledby="lib-title">
        <div className={styles.cardHead}>
          <h2 id="lib-title">How each setup has performed</h2>
          <Explain title="Reading this table">
            Every past case of each setup on every coin. Break-even is the win rate needed to profit
            given the average win size (single-candle patterns target 1.5× risk, so they need about
            40%). Edge candidate: at least 30 cases and the whole 95% range above break-even.
            Results are before fees; Phase 2 re-tests candidates with costs.
          </Explain>
          <p>
            {coins} coins · {INTERVAL} · before fees. Location changes results, so each pattern is
            measured inside demand zones and in open space separately.
          </p>
        </div>
        <div className={styles.xs}>
          <table className={styles.tbl}>
            <thead>
              <tr>
                <th>Setup</th>
                <th className={styles.r}>n</th>
                <th className={styles.r}>Win rate</th>
                <th className={styles.ciCol}>95% range · break-even</th>
                <th className={styles.r}>Avg win</th>
                <th className={styles.r}>Avg loss</th>
                <th className={styles.r}>Expectancy</th>
                <th>Verdict</th>
              </tr>
            </thead>
            <tbody>
              {library.map((s) => (
                <tr key={s.key}>
                  <td>
                    <b>{setupLabel(s)}</b>
                  </td>
                  <td className={`${styles.r} ${styles.num}`}>{s.n}</td>
                  <td className={`${styles.r} ${styles.num}`}>{pct(s.winRate)}</td>
                  <td>
                    <CiBar stats={s} />
                  </td>
                  <td className={`${styles.r} ${styles.num} ${styles.up}`}>
                    {signedPct(s.avgWinPct)}
                  </td>
                  <td className={`${styles.r} ${styles.num} ${styles.down}`}>
                    {signedPct(s.avgLossPct)}
                  </td>
                  <td
                    className={`${styles.r} ${styles.num} ${s.expectancyR >= 0 ? styles.up : styles.down}`}
                  >
                    {signedR(s.expectancyR)}
                  </td>
                  <td>
                    <VerdictChip verdict={s.verdict} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

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
