import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { RESEARCH_UNIVERSE } from "../../services/HistoryService";
import { MarketDataService } from "../../services/MarketDataService";
import { useUniverseCandles } from "../../custom-hooks/useUniverseCandles";
import { useCatalog, useScanner, useStats } from "../../custom-hooks/useAnalysisApi";
import { useLivePrice } from "../../custom-hooks/useLivePrice";
import { loadWatchlist } from "../../utils/watchlistStorage";
import { patternLabel } from "../../utils/patternLabels";
import { locationLabel, toStats } from "../../utils/setupKeys";
import { statsByKey } from "../../utils/setupLibrary";
import { loadDetection, zoneTfFor } from "../../utils/detectionConfig";
import { pct, price, signedPct, signedR } from "../../utils/format";
import type { Candle } from "../../types/marketData";
import type { SetupOccurrence, SetupStats } from "../../types/analysis";
import { Chip, CiBar, Explain, VerdictChip } from "../../common-components/Evidence";
import MarketOverview from "../MarketOverview";
import styles from "./DashboardPage.module.scss";

const INTERVAL = "4h" as const;
const SPARK = 42; // 7 days of 4h candles

function setupLabel(s: Pick<SetupStats, "pattern" | "direction" | "location">) {
  return `${s.direction === "long" ? "▲" : "▼"} ${patternLabel(s.pattern)} · ${locationLabel(s.location, s.direction)}`;
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
  const { candles, failed } = useUniverseCandles(universe, INTERVAL, attempt);
  const zoneTf = useMemo(() => zoneTfFor(INTERVAL, loadDetection().zones), []);
  const catalog = useCatalog().data;
  const scanner = useScanner(INTERVAL, zoneTf, watchlist);
  const statsRes = useStats(INTERVAL, zoneTf);
  const run = statsRes.data?.run ?? null;
  const ready = scanner.data !== null;
  const serviceError = scanner.error ?? statsRes.error;

  useEffect(() => {
    MarketDataService.getInstance().startMarketData(watchlist);
  }, [watchlist]);

  const current = useMemo(
    () =>
      (scanner.data?.items ?? []).map((i) => {
        const o: SetupOccurrence = { ...i.occurrence, symbol: i.symbol };
        return {
          occurrence: o,
          pooled: i.pooled ? toStats(o.pattern, o.direction, o.location, i.pooled) : null,
        };
      }),
    [scanner.data],
  );
  const edgeNow = current.filter((c) => c.pooled?.verdict === "edge").length;
  const library = useMemo(
    () =>
      [...statsByKey(statsRes.data).values()]
        .filter((s) => s.location !== "*" && s.n > 0)
        .sort((a, b) => b.n - a.n),
    [statsRes.data],
  );
  const tracked = library.reduce((s, x) => s + x.n + x.expired, 0);
  const coins = run ? run.coins.length - run.failed.length : 0;
  const days = run?.days ?? 0;
  const top =
    current.find((c) => c.pooled?.verdict === "edge") ??
    current.find((c) => c.pooled) ??
    current[0];
  const patternCount = catalog?.patterns.length ?? 0;

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
          Scanner · {patternCount || "…"} patterns × 4 locations × {universe.length} coins ·{" "}
          {INTERVAL} · {zoneTf} levels
        </span>
        <h2 id="band-title">
          {!ready
            ? serviceError
              ? "The analysis service is offline."
              : `Scanning ${universe.length} coins…`
            : current.length === 0
              ? "No setups on the last 3 closed candles."
              : `${current.length} setup${current.length === 1 ? "" : "s"} on the last 3 closed candles. ${edgeNow} with a measured edge.`}
        </h2>
        <p>
          {!ready
            ? (serviceError ?? "Detecting patterns on the latest closed candles of every coin…")
            : top?.pooled
              ? `${top.occurrence.symbol} printed a ${top.occurrence.direction === "long" ? "bullish" : "bearish"} ${patternLabel(top.occurrence.pattern).toLowerCase()} ${locationLabel(top.occurrence.location, top.occurrence.direction)}. Across ${top.pooled.n} past cases on ${coins} coins it reached its target ${pct(top.pooled.winRate)} of the time (range ${pct(top.pooled.ci[0])}–${pct(top.pooled.ci[1])}).`
              : "The scanner re-checks at every candle close. Below is how each setup has performed so far."}
        </p>
        <div className={styles.kpis}>
          <div>
            <span className={styles.lbl}>Setups now</span>
            <span className={styles.num}>{ready ? current.length : "…"}</span>
          </div>
          <div>
            <span className={styles.lbl}>Edge candidates</span>
            <span className={`${styles.num} ${styles.up}`}>{ready ? edgeNow : "…"}</span>
          </div>
          <div>
            <span className={styles.lbl}>Patterns measured</span>
            <span className={styles.num}>{run ? tracked.toLocaleString("en-US") : "…"}</span>
          </div>
          <div>
            <span className={styles.lbl}>History</span>
            <span className={styles.num}>{run ? `${coins} coins · ${days} d` : "…"}</span>
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
              A pattern (double bottom, engulfing, triangle…) in a direction plus its location (at a{" "}
              {zoneTf} demand/supply zone, an order block, both, or open space), confirmed on one of
              the last 3 closed {INTERVAL} candles. The win rate is the same setup across every
              coin's history: target hit before stop within {catalog?.maxHoldBars ?? 30} candles.
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
                  <tr key={`${o.symbol}${o.pattern}${o.direction}${o.time}`}>
                    <td>
                      <b>{o.symbol}</b>
                    </td>
                    <td>
                      <span className={o.direction === "long" ? styles.up : styles.down}>
                        {o.direction === "long" ? "▲" : "▼"}
                      </span>{" "}
                      {patternLabel(o.pattern)}{" "}
                      <span className={styles.mute}>{locationLabel(o.location, o.direction)}</span>
                    </td>
                    <td className={`${styles.r} ${styles.num}`}>{p ? p.n : "—"}</td>
                    <td>
                      {p ? (
                        <div className={styles.ciCell}>
                          <span className={styles.num}>{pct(p.winRate)}</span>
                          <CiBar stats={p} />
                        </div>
                      ) : (
                        <span className={styles.mute}>not measured yet</span>
                      )}
                    </td>
                    <td className={`${styles.r} ${styles.num} ${styles.up}`}>
                      {p ? signedPct(p.avgWinPct) : "—"}
                    </td>
                    <td>{p && <VerdictChip verdict={p.verdict} />}</td>
                    <td>
                      <Link className={styles.btnSm} to={`/chart/${o.symbol}`}>
                        Chart
                      </Link>
                    </td>
                  </tr>
                ))}
                {ready && current.length === 0 && (
                  <tr>
                    <td colSpan={7} className={styles.mute}>
                      Nothing confirmed on the last 3 closed {INTERVAL} candles. The table below
                      shows how each setup has done.
                    </td>
                  </tr>
                )}
                {!ready && (
                  <tr>
                    <td colSpan={7} className={styles.mute}>
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
            Every past case of each setup on every coin, measured in the background. Break-even is
            the win rate needed to profit given the average win size (candlestick patterns target
            1.5× risk, so they need 40%). Edge candidate: at least {catalog?.minSample ?? 30} cases
            and the whole 95% range above break-even. Results are before fees; Phase 2 re-tests
            candidates with costs.
          </Explain>
          <p>
            {coins} coins · {days} days · {INTERVAL} · {zoneTf} levels · before fees. Location
            changes results, so each pattern is measured at zones, order blocks, both, and in open
            space.
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
              {library.slice(0, 15).map((s) => (
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
        {library.length > 15 && (
          <p className={styles.mute}>
            The 15 setups with the most cases.{" "}
            <Link to="/stats">All {library.length} in Pattern stats</Link>.
          </p>
        )}
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
