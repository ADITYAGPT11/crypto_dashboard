import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { CandleInterval } from "../../types/marketData";
import type { SetupOccurrence } from "../../types/analysis";
import { RESEARCH_UNIVERSE } from "../../services/HistoryService";
import { useHistory } from "../../custom-hooks/useHistory";
import { useScan } from "../../custom-hooks/useScan";
import { loadWatchlist } from "../../utils/watchlistStorage";
import { analyzeSymbol, LOCATION_LABELS, setupKey, summarizeAll } from "../../utils/setupAnalysis";
import { PATTERN_LABELS } from "../../utils/patterns";
import { computeVolumeProfile } from "../../utils/volumeProfile";
import { ema, sma } from "../../utils/indicators";
import { pct, price, shortDate } from "../../utils/format";
import { Chip, Explain } from "../../common-components/Evidence";
import PriceChart, { type Layers } from "./PriceChart";
import SetupCard, { type Check } from "./SetupCard";
import styles from "./ChartPage.module.scss";

const INTERVALS: CandleInterval[] = ["1h", "4h", "1d"];
const LAYER_LABELS: [keyof Layers, string, string][] = [
  ["ema", "EMA 50", "#F0A35E"],
  ["bb", "Bollinger", "#7DB4FF"],
  ["zones", "Zones", "#56D364"],
  ["vp", "Volume profile", "#4C9AFF"],
  ["pattern", "Pattern", "#E6EDF3"],
];
const occId = (o: SetupOccurrence) => `${o.hit.type}-${o.hit.index}`;

const ChartPage: React.FC = () => {
  const params = useParams();
  const navigate = useNavigate();
  const watchlist = useMemo(() => loadWatchlist(), []);
  const universe = useMemo(() => [...new Set([...watchlist, ...RESEARCH_UNIVERSE])], [watchlist]);
  const symbol = (params.symbol ?? watchlist[0] ?? "BTC-USDT").toUpperCase();
  const scanSymbols = useMemo(
    () => (universe.includes(symbol) ? universe : [...universe, symbol]),
    [universe, symbol],
  );

  const [interval, setIntervalState] = useState<CandleInterval>("4h");
  const [attempt, setAttempt] = useState(0);
  const [layers, setLayers] = useState<Layers>({
    ema: true,
    bb: false,
    zones: true,
    vp: true,
    pattern: true,
  });
  const [selId, setSelId] = useState<string | null>(null);

  const hist = useHistory(symbol, interval, attempt);
  const scan = useScan(scanSymbols, interval, attempt);
  const candles = hist.candles;

  const analysis = useMemo(
    () => (candles.length ? analyzeSymbol(symbol, candles) : null),
    [symbol, candles],
  );
  const own = useMemo(() => (analysis ? summarizeAll(analysis.occurrences) : null), [analysis]);
  const recent = useMemo(
    () =>
      analysis
        ? [...analysis.occurrences].sort((a, b) => b.hit.index - a.hit.index).slice(0, 8)
        : [],
    [analysis],
  );
  const selected = recent.find((o) => occId(o) === selId) ?? recent[0] ?? null;
  const key = selected ? setupKey(selected.hit.type, selected.location) : null;
  const history = useMemo(
    () =>
      analysis && selected
        ? analysis.occurrences.filter(
            (o) => o.hit.type === selected.hit.type && o.location === selected.location,
          )
        : [],
    [analysis, selected],
  );
  const pooled = key && scan.scan ? (scan.scan.pooled.get(key) ?? null) : null;
  const ownStats = key && own ? (own.get(key) ?? null) : null;

  const profile = useMemo(() => computeVolumeProfile(candles.slice(-200), 48), [candles]);
  const indicators = useMemo(() => {
    const closes = candles.map((c) => c.close);
    return {
      ema50: ema(closes, 50),
      vol20: sma(
        candles.map((c) => c.volume),
        20,
      ),
    };
  }, [candles]);

  const checks: Check[] = useMemo(() => {
    if (!selected || candles.length === 0) return [];
    const i = selected.hit.index;
    const out: Check[] = [];
    out.push(
      selected.location === "demandZone"
        ? { ok: true, text: "Pattern low sits inside an intact demand zone" }
        : { ok: false, text: "Not at a demand zone (open space)" },
    );
    const avgVol = indicators.vol20[i - 1];
    if (Number.isFinite(avgVol) && avgVol > 0) {
      const ratio = candles[i].volume / avgVol;
      out.push({
        ok: ratio >= 1.2,
        text: `Confirmation candle on ${ratio.toFixed(1)}× the 20-candle average volume`,
      });
    }
    const e = indicators.ema50[i];
    if (Number.isFinite(e)) {
      out.push(
        candles[i].close > e
          ? { ok: true, text: "Above EMA 50: with the trend" }
          : { ok: false, text: "Below EMA 50: against the trend" },
      );
    }
    const prior = computeVolumeProfile(candles.slice(Math.max(0, i - 200), i + 1), 48);
    if (prior) {
      out.push(
        selected.hit.entry > prior.pocPrice
          ? { ok: true, text: `Entry above the point of control (${price(prior.pocPrice)})` }
          : {
              ok: false,
              text: `Entry below the point of control (${price(prior.pocPrice)}): volume overhead`,
            },
      );
    }
    return out;
  }, [selected, candles, indicators]);

  // Intact zones nearest to the current price first, then the most recently broken.
  const zonesShown = useMemo(() => {
    if (!analysis || candles.length === 0) return [];
    const px = candles[candles.length - 1].close;
    const dist = (z: { low: number; high: number }) => Math.abs((z.low + z.high) / 2 - px);
    const intact = analysis.zones
      .filter((z) => z.endIndex === null)
      .sort((a, b) => dist(a) - dist(b));
    const broken = analysis.zones
      .filter((z) => z.endIndex !== null)
      .sort((a, b) => (b.endIndex ?? 0) - (a.endIndex ?? 0));
    return [...intact.slice(0, 5), ...broken.slice(0, 2)];
  }, [analysis, candles]);

  const levels = profile
    ? [
        {
          tag: "POC",
          price: profile.pocPrice,
          text: "Point of control: most traded price",
          tone: "info" as const,
        },
        {
          tag: "VAH",
          price: profile.vahPrice,
          text: "Top of the 70% value area",
          tone: "lock" as const,
        },
        {
          tag: "VAL",
          price: profile.valPrice,
          text: "Bottom of the value area",
          tone: "lock" as const,
        },
        ...profile.hvn.map((p) => ({
          tag: "HVN",
          price: p,
          text: "High-volume node: price tends to stall",
          tone: "up" as const,
        })),
        ...profile.lvn.map((p) => ({
          tag: "LVN",
          price: p,
          text: "Low-volume node: price moves through fast",
          tone: "warn" as const,
        })),
      ].sort((a, b) => b.price - a.price)
    : [];

  const last = candles[candles.length - 1];
  const days =
    candles.length > 1
      ? Math.round((candles[candles.length - 1].openTime - candles[0].openTime) / 86_400_000)
      : 0;
  const retry = () => setAttempt((a) => a + 1);

  return (
    <main className={styles.page}>
      <div className={styles.pagehead}>
        <div>
          <h1>Chart</h1>
          <p>Indicators, patterns, zones and volume levels, with the history of every setup.</p>
        </div>
        {candles.length > 0 && (
          <p className={styles.meta}>
            {candles.length.toLocaleString("en-US")} closed {interval} candles · {days} days ·
            Binance perp
          </p>
        )}
      </div>

      <div className={styles.ws}>
        <div className={styles.col}>
          <div className={styles.chartCard}>
            <div className={styles.toolbar} role="toolbar" aria-label="Chart controls">
              <label className="sr-only" htmlFor="chart-symbol">
                Symbol
              </label>
              <select
                id="chart-symbol"
                className={styles.symbol}
                value={symbol}
                onChange={(e) => navigate(`/chart/${e.target.value}`)}
              >
                {scanSymbols.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              {last && <span className={styles.lastPx}>{price(last.close)}</span>}
              <div className={styles.seg} role="group" aria-label="Candle size">
                {INTERVALS.map((iv) => (
                  <button
                    key={iv}
                    type="button"
                    aria-pressed={iv === interval}
                    onClick={() => setIntervalState(iv)}
                  >
                    {iv}
                  </button>
                ))}
              </div>
              {LAYER_LABELS.map(([k, label, color]) => (
                <button
                  key={k}
                  type="button"
                  className={styles.tog}
                  aria-pressed={layers[k]}
                  onClick={() => setLayers((l) => ({ ...l, [k]: !l[k] }))}
                >
                  <i style={{ background: color }} aria-hidden="true" />
                  {label}
                </button>
              ))}
            </div>
            {hist.loading && (
              <div className={styles.state}>
                Loading {interval} history for {symbol} from Binance…
              </div>
            )}
            {hist.error && (
              <div className={styles.state} role="alert">
                <span>
                  Couldn't load {symbol} history: {hist.error}. Check your connection; Binance's
                  public API must be reachable from this browser.
                </span>
                <button type="button" className={styles.btn} onClick={retry}>
                  Try again
                </button>
              </div>
            )}
            <PriceChart
              candles={candles}
              zones={analysis?.zones ?? []}
              selected={selected}
              history={history}
              layers={layers}
            />
            <div className={styles.legend} aria-hidden="true">
              <span>
                <i style={{ background: "rgba(86,211,100,.35)" }} />
                Demand zone
              </span>
              <span>
                <i style={{ background: "rgba(244,112,103,.35)" }} />
                Supply zone
              </span>
              <span>
                <i style={{ background: "rgba(76,154,255,.5)" }} />
                Volume by price
              </span>
              <span>▲ W / L = past outcomes of the selected setup</span>
            </div>
          </div>

          <div className={styles.grid2}>
            <section className={styles.card} aria-labelledby="levels-title">
              <div className={styles.cardHead}>
                <h2 id="levels-title">Key volume levels</h2>
                <Explain title="Volume levels">
                  Volume by price over the last 200 candles. POC is the most traded price; VAH/VAL
                  bound the 70% value area. High-volume nodes tend to slow price; low-volume nodes
                  are gaps price crosses quickly.
                </Explain>
                <p>Last 200 candles. The chart's histogram follows the visible range.</p>
              </div>
              <ul className={styles.levels}>
                {levels.map((l) => (
                  <li key={`${l.tag}${l.price}`}>
                    <Chip tone={l.tone}>{l.tag}</Chip>
                    <span className={styles.mute}>{l.text}</span>
                    <span className={styles.num}>{price(l.price)}</span>
                  </li>
                ))}
              </ul>
            </section>
            <section className={styles.card} aria-labelledby="zones-title">
              <div className={styles.cardHead}>
                <h2 id="zones-title">Zones</h2>
                <Explain title="Supply and demand zones">
                  The base candle right before a large, high-volume move. A test is price returning
                  into the zone; it holds when price closes back out on the original side, and
                  breaks on a close through the far edge.
                </Explain>
                <p>Intact zones nearest to price first, then the most recently broken.</p>
              </div>
              <div className={styles.xs}>
                <table className={styles.tbl}>
                  <thead>
                    <tr>
                      <th>Zone</th>
                      <th className={styles.r}>Range</th>
                      <th className={styles.r}>Tests</th>
                      <th className={styles.r}>Held</th>
                      <th>State</th>
                    </tr>
                  </thead>
                  <tbody>
                    {zonesShown.map((z) => (
                      <tr key={`${z.kind}${z.formedIndex}`}>
                        <td>
                          <Chip tone={z.kind === "demand" ? "up" : "down"}>
                            {z.kind === "demand" ? "Demand" : "Supply"}
                          </Chip>
                        </td>
                        <td className={`${styles.r} ${styles.num}`}>
                          {price(z.low)}–{price(z.high)}
                        </td>
                        <td className={`${styles.r} ${styles.num}`}>{z.tests}</td>
                        <td className={`${styles.r} ${styles.num}`}>{z.held}</td>
                        <td className={styles.mute}>
                          {z.endIndex === null
                            ? "intact"
                            : `broke ${shortDate(candles[z.endIndex].openTime)}`}
                        </td>
                      </tr>
                    ))}
                    {zonesShown.length === 0 && (
                      <tr>
                        <td colSpan={5} className={styles.mute}>
                          No zones detected in this history.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        </div>

        <aside className={styles.col} aria-label="Setups">
          <section className={styles.card} aria-labelledby="pat-title">
            <div className={styles.cardHead}>
              <h2 id="pat-title">Patterns on this chart</h2>
              <p>Most recent first. Pick one to see its history.</p>
            </div>
            <ul className={styles.patList}>
              {recent.map((o) => {
                const st = scan.scan?.pooled.get(setupKey(o.hit.type, o.location));
                const isNow = o.hit.index >= candles.length - 3;
                return (
                  <li key={occId(o)}>
                    <button
                      type="button"
                      aria-pressed={selected !== null && occId(o) === occId(selected)}
                      onClick={() => setSelId(occId(o))}
                    >
                      <b>
                        {PATTERN_LABELS[o.hit.type]}{" "}
                        <span className={styles.mute}>{LOCATION_LABELS[o.location]}</span>
                      </b>
                      <span className={styles.num}>{st ? pct(st.winRate) : "…"}</span>
                      <small>
                        {isNow ? "Now" : shortDate(o.time)} ·{" "}
                        {st ? `${st.n} past cases` : "pooling…"}
                      </small>
                    </button>
                  </li>
                );
              })}
              {analysis && recent.length === 0 && (
                <li className={styles.mute}>No patterns detected in this history.</li>
              )}
            </ul>
            {scan.failed.length > 0 && (
              <p className={styles.note}>
                Pooled without {scan.failed.join(", ")} (history failed to load).{" "}
                <button type="button" className={styles.link} onClick={retry}>
                  Retry
                </button>
              </p>
            )}
          </section>
          {selected && (
            <SetupCard
              occurrence={selected}
              interval={interval}
              isCurrent={selected.hit.index >= candles.length - 3}
              pooled={pooled}
              own={ownStats}
              coins={scan.candles.size || scanSymbols.length}
              pooling={scan.loading}
              checks={checks}
            />
          )}
        </aside>
      </div>
    </main>
  );
};

export default ChartPage;
