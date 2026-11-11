import { useMemo, useRef, useState } from "react";
import type { DrawingKind } from "lightweight-charts-drawing";
import { useNavigate, useParams } from "react-router-dom";
import { CANDLE_INTERVALS, type Candle, type CandleInterval } from "../../types/marketData";
import type { AnalysisOut } from "../../api/schema";
import type { SetupOccurrence } from "../../types/analysis";
import { useHistories } from "../../custom-hooks/useHistories";
import { researchUniverse } from "../../custom-hooks/useUniverseCandles";
import {
  useAnalysis,
  useCatalog,
  useSetupDetail,
  useStats,
} from "../../custom-hooks/useAnalysisApi";
import { locationLabel, setupKey, toStats } from "../../utils/setupKeys";
import { statsByKey } from "../../utils/setupLibrary";
import { patternLabel } from "../../utils/patternLabels";
import { computeVolumeProfile } from "../../utils/volumeProfile";
import { ema, sma } from "../../utils/indicators";
import { pct, price, shortDate } from "../../utils/format";
import {
  activeTfs,
  DETECTION_TFS,
  loadDetection,
  saveDetection,
  tfsFor,
  zoneTfFor,
  type DetectionConfig,
} from "../../utils/detectionConfig";
import {
  TF_MS,
  toViewLevels,
  toViewPattern,
  viewBarTimeForClose,
  type ViewPattern,
} from "../../utils/timeframeMapping";
import { Chip, Explain } from "../../common-components/Evidence";
import PriceChart, {
  type ChartHandle,
  type IndicatorAction,
  type Layers,
  type ViewMarker,
} from "./PriceChart";
import ChartToolbar from "./ChartToolbar";
import DrawingToolbar from "./DrawingToolbar";
import IndicatorsDialog from "./IndicatorsDialog";
import IndicatorSettings from "./IndicatorSettings";
import LiquidityPanel from "./LiquidityPanel";
import { useLiveCandle } from "../../custom-hooks/useLiveCandle";
import { useLiquidity } from "../../custom-hooks/useLiquidity";
import { heatmapFrame, liquidityPools } from "../../utils/liquidityHeatmap";
import {
  CHART_PREFS_STORAGE_KEY,
  loadJson,
  parseChartPrefs,
  saveJson,
  type ChartPrefs,
} from "../../utils/chartDisplay";
import {
  INDICATORS_STORAGE_KEY,
  newInstance,
  parseInstances,
  type IndicatorId,
  type IndicatorInstance,
} from "../../utils/indicatorRegistry";
import SetupCard, { type Check } from "./SetupCard";
import DetectionSettings from "./DetectionSettings";
import { TfBadge } from "./TfBadge";
import styles from "./ChartPage.module.scss";

/** An occurrence plus the timeframe it was detected on and its zone source. */
interface Found {
  occ: SetupOccurrence;
  tf: CandleInterval;
  zoneTf: CandleInterval;
  /** Close time of the confirmation candle (when the signal existed). */
  closeTime: number;
}
const foundId = (f: Found) => `${f.tf}-${f.occ.pattern}-${f.occ.direction}-${f.occ.time}`;
const keyOf = (o: Pick<SetupOccurrence, "pattern" | "direction" | "location">) =>
  setupKey(o.pattern, o.direction, o.location);
const NO_CANDLES: Candle[] = [];
const LEVEL_LABEL: Record<string, string> = {
  demand: "Demand",
  supply: "Supply",
  bullish: "Bull OB",
  bearish: "Bear OB",
};

const ChartPage: React.FC = () => {
  const params = useParams();
  const navigate = useNavigate();
  const universe = useMemo(() => researchUniverse(), []);
  const symbol = (params.symbol ?? universe[0] ?? "BTC-USDT").toUpperCase();
  const symbols = useMemo(
    () => (universe.includes(symbol) ? universe : [...universe, symbol]),
    [universe, symbol],
  );

  const [viewTf, setViewTf] = useState<CandleInterval>("4h");
  const [config, setConfigState] = useState<DetectionConfig>(() => loadDetection());
  const setConfig = (cfg: DetectionConfig) => {
    setConfigState(cfg);
    saveDetection(cfg);
  };
  const [showTf, setShowTf] = useState<Record<string, boolean>>({
    "1h": true,
    "4h": true,
    "1d": true,
  });
  const [attempt, setAttempt] = useState(0);
  const [layers, setLayers] = useState<Layers>({
    zones: true,
    orderBlocks: true,
    fvg: false,
    vp: true,
    pattern: true,
    heatmap: false,
  });
  const [prefs, setPrefsState] = useState<ChartPrefs>(() =>
    loadJson(CHART_PREFS_STORAGE_KEY, parseChartPrefs),
  );
  const setPrefs = (next: ChartPrefs) => {
    setPrefsState(next);
    saveJson(CHART_PREFS_STORAGE_KEY, next);
  };
  const [indicators, setIndicatorsState] = useState<IndicatorInstance[]>(() =>
    loadJson(INDICATORS_STORAGE_KEY, parseInstances),
  );
  const setIndicators = (next: IndicatorInstance[]) => {
    setIndicatorsState(next);
    saveJson(INDICATORS_STORAGE_KEY, next);
  };
  const [dialog, setDialog] = useState<
    { kind: "indicators" } | { kind: "settings"; uid: string } | null
  >(null);
  const [tool, setTool] = useState<DrawingKind | null>(null);
  const [magnet, setMagnet] = useState(false);
  const [drawingsVisible, setDrawingsVisible] = useState(true);
  const chartHandle = useRef<ChartHandle | null>(null);
  const chartCardRef = useRef<HTMLDivElement>(null);
  const onIndicator = (uid: string, action: IndicatorAction) => {
    if (action === "settings") setDialog({ kind: "settings", uid });
    else if (action === "remove") setIndicators(indicators.filter((i) => i.uid !== uid));
    else setIndicators(indicators.map((i) => (i.uid === uid ? { ...i, visible: !i.visible } : i)));
  };
  const addIndicator = (id: IndicatorId) =>
    setIndicators([...indicators, newInstance(id, `${id}-${Date.now().toString(36)}`)]);
  const screenshot = () => {
    const url = chartHandle.current?.screenshot();
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = `${symbol}-${viewTf}-${new Date().toISOString().slice(0, 16).replace(":", "")}.png`;
    a.click();
  };

  const [selId, setSelId] = useState<string | null>(null);

  // The rule set lives in the backend: patterns, zones and order blocks per detection timeframe.
  const catalog = useCatalog().data;
  const patternTfs = useMemo(() => activeTfs(config, catalog), [config, catalog]);
  const zoneFor = (tf: CandleInterval) => zoneTfFor(tf, config.zones);
  const a1h = useAnalysis(patternTfs.includes("1h") ? symbol : null, "1h", zoneFor("1h"));
  const a4h = useAnalysis(patternTfs.includes("4h") ? symbol : null, "4h", zoneFor("4h"));
  const a1d = useAnalysis(patternTfs.includes("1d") ? symbol : null, "1d", zoneFor("1d"));
  const analyses = useMemo(() => {
    const out = new Map<CandleInterval, AnalysisOut>();
    if (a1h.data) out.set("1h", a1h.data);
    if (a4h.data) out.set("4h", a4h.data);
    if (a1d.data) out.set("1d", a1d.data);
    return out;
  }, [a1h.data, a4h.data, a1d.data]);
  const analysisError = [a1h, a4h, a1d].find((a) => a.error)?.error ?? null;
  const analysisLoading = [a1h, a4h, a1d].some((a) => a.loading && !a.data);

  const found: Found[] = useMemo(() => {
    const out: Found[] = [];
    const byId = new Map((catalog?.patterns ?? []).map((p) => [p.id, p]));
    for (const [tf, a] of analyses) {
      for (const occ of a.occurrences) {
        const spec = byId.get(occ.pattern);
        if (spec && !tfsFor(config, spec).includes(tf)) continue;
        out.push({
          occ: { ...occ, symbol },
          tf,
          zoneTf: a.zoneTf as CandleInterval,
          closeTime: occ.time + TF_MS[tf],
        });
      }
    }
    return out.sort((x, y) => y.closeTime - x.closeTime);
  }, [analyses, config, catalog, symbol]);

  const recent = useMemo(() => found.filter((f) => showTf[f.tf]).slice(0, 12), [found, showTf]);
  const selected = recent.find((f) => foundId(f) === selId) ?? recent[0] ?? null;
  const selTf = selected?.tf ?? patternTfs[0] ?? "4h";
  const selZoneTf = selected?.zoneTf ?? zoneFor(selTf);
  const selAnalysis = analyses.get(selTf) ?? analyses.values().next().value ?? null;

  const needed = useMemo(
    () => CANDLE_INTERVALS.filter((tf) => tf === viewTf || tf === selTf),
    [viewTf, selTf],
  );
  const hist = useHistories(symbol, needed, attempt);
  const view = hist.get(viewTf)!;
  const live = useLiveCandle(symbol, viewTf);
  const candles = view.candles;
  const selCandles = hist.get(selTf)?.candles ?? NO_CANDLES;

  // Pooled statistics from the background job (all coins, one to two years).
  const ctxStats = useStats(selTf, selZoneTf);
  const statsMap = useMemo(() => statsByKey(ctxStats.data), [ctxStats.data]);
  const key = selected ? keyOf(selected.occ) : null;
  const pooled = key ? (statsMap.get(key) ?? null) : null;
  const baseline = selected
    ? (statsMap.get(setupKey(selected.occ.pattern, selected.occ.direction, "*")) ?? null)
    : null;
  const detail = useSetupDetail(
    selTf,
    selZoneTf,
    selected
      ? {
          pattern: selected.occ.pattern,
          direction: selected.occ.direction,
          location: selected.occ.location,
        }
      : null,
  ).data;
  const ownRow = detail?.perCoin.find((c) => c.symbol === symbol);
  const own =
    selected && ownRow
      ? toStats(selected.occ.pattern, selected.occ.direction, selected.occ.location, ownRow.summary)
      : null;

  // Past cases of the selected setup on this chart, as markers.
  const history = useMemo(
    () =>
      selected
        ? (analyses.get(selected.tf)?.occurrences ?? []).filter((o) => keyOf(o) === key)
        : [],
    [analyses, selected, key],
  );

  // Everything drawn on the chart, mapped onto the view timeframe by time.
  const viewSelected: ViewPattern | null = useMemo(
    () =>
      selected && candles.length ? toViewPattern(selected.occ, selected.tf, candles, viewTf) : null,
    [selected, candles, viewTf],
  );
  const viewOthers = useMemo(
    () =>
      candles.length
        ? recent
            .filter((f) => f !== selected)
            .map((f) => toViewPattern(f.occ, f.tf, candles, viewTf))
        : [],
    [recent, selected, candles, viewTf],
  );
  const markers: ViewMarker[] = useMemo(() => {
    if (!selected || !candles.length) return [];
    return history.flatMap((o) => {
      const time = viewBarTimeForClose(candles, o.time, TF_MS[selected.tf]);
      return time === null
        ? []
        : [
            {
              time,
              result: o.outcome.result,
              current: o.time === selected.occ.time,
              direction: o.direction,
            },
          ];
    });
  }, [history, selected, candles]);

  const levelTf = (selAnalysis?.zoneTf ?? selZoneTf) as CandleInterval;
  const viewLevels = useMemo(
    () =>
      selAnalysis && candles.length ? toViewLevels(selAnalysis, levelTf, candles, viewTf) : [],
    [selAnalysis, levelTf, candles, viewTf],
  );

  const profile = useMemo(() => computeVolumeProfile(candles.slice(-200), 48), [candles]);
  // EMA 50 and 20-candle volume on the pattern's timeframe, for the context checks.
  const context = useMemo(() => {
    const closes = selCandles.map((c) => c.close);
    return {
      ema50: ema(closes, 50),
      vol20: sma(
        selCandles.map((c) => c.volume),
        20,
      ),
    };
  }, [selCandles]);

  const checks: Check[] = useMemo(() => {
    if (!selected) return [];
    const o = selected.occ;
    const long = o.direction === "long";
    const out: Check[] = [];
    out.push(
      o.location === "openSpace"
        ? { ok: false, text: `Not at a ${selected.zoneTf} zone or order block (open space)` }
        : { ok: true, text: `${locationLabel(o.location, o.direction)} (${selected.zoneTf})` },
    );
    const i = selCandles.findIndex((c) => c.openTime === o.time);
    if (i > 0) {
      const avgVol = context.vol20[i - 1];
      if (Number.isFinite(avgVol) && avgVol > 0) {
        const ratio = selCandles[i].volume / avgVol;
        out.push({
          ok: ratio >= 1.2,
          text: `Confirmation candle on ${ratio.toFixed(1)}× the 20-candle average volume`,
        });
      }
      const e = context.ema50[i];
      if (Number.isFinite(e)) {
        const withTrend = long ? selCandles[i].close > e : selCandles[i].close < e;
        out.push({
          ok: withTrend,
          text: `${selCandles[i].close > e ? "Above" : "Below"} EMA 50 (${selected.tf}): ${withTrend ? "with" : "against"} the trend`,
        });
      }
      const prior = computeVolumeProfile(selCandles.slice(Math.max(0, i - 200), i + 1), 48);
      if (prior) {
        const clear = long ? o.entry > prior.pocPrice : o.entry < prior.pocPrice;
        out.push({
          ok: clear,
          text: `Entry ${o.entry > prior.pocPrice ? "above" : "below"} the point of control (${price(prior.pocPrice)})${clear ? "" : ": volume in the way"}`,
        });
      }
    }
    return out;
  }, [selected, selCandles, context]);

  // Key levels: intact zones and order blocks nearest to price, then the most recently broken.
  const levelsShown = useMemo(() => {
    if (!selAnalysis || !candles.length) return [];
    const px = candles[candles.length - 1].close;
    const rows = [
      ...selAnalysis.zones.map((z) => ({
        id: `z${z.formedTime}${z.kind}`,
        kind: z.kind,
        low: z.low,
        high: z.high,
        state:
          z.endTime === null
            ? z.tests === 0
              ? "fresh"
              : `tested ${z.tests}×, held ${z.held}`
            : null,
        end: z.endTime,
        strength: `${z.departureAtr.toFixed(1)} ATR`,
      })),
      ...selAnalysis.orderBlocks.map((b) => ({
        id: `b${b.formedTime}${b.kind}`,
        kind: b.kind,
        low: b.low,
        high: b.high,
        state: b.endTime === null ? (b.mitigatedTime === null ? "unmitigated" : "mitigated") : null,
        end: b.endTime,
        strength: `BOS ${price(b.broke)}`,
      })),
    ];
    const dist = (r: { low: number; high: number }) => Math.abs((r.low + r.high) / 2 - px);
    const intact = rows.filter((r) => r.end === null).sort((a, b) => dist(a) - dist(b));
    const broken = rows.filter((r) => r.end !== null).sort((a, b) => (b.end ?? 0) - (a.end ?? 0));
    return [...intact.slice(0, 8), ...broken.slice(0, 2)];
  }, [selAnalysis, candles]);

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
  const behind = selAnalysis?.coverage.behind ?? 0;

  // Order-book liquidity (only while the heatmap layer is on: no sockets otherwise).
  const liquidity = useLiquidity(layers.heatmap ? symbol : null);
  const heatmap = useMemo(
    () => (layers.heatmap ? heatmapFrame(liquidity.samples, TF_MS[viewTf]) : null),
    [layers.heatmap, liquidity.samples, viewTf],
  );
  const pools = useMemo(() => liquidityPools(liquidity.samples), [liquidity.samples]);

  const last = candles[candles.length - 1];
  const days =
    candles.length > 1
      ? Math.round((candles[candles.length - 1].openTime - candles[0].openTime) / 86_400_000)
      : 0;
  const retry = () => setAttempt((a) => a + 1);
  const isNow = (f: Found) =>
    (analyses.get(f.tf)?.coverage.last ?? 0) - f.occ.time < 3 * TF_MS[f.tf];

  return (
    <main className={styles.page}>
      <div className={styles.pagehead}>
        <div>
          <h1>Chart</h1>
          <p>
            Patterns, demand/supply zones and order blocks found by the analysis service on the
            timeframes you pick, drawn on the timeframe you view, with the record of every setup.
          </p>
        </div>
        {candles.length > 0 && (
          <p className={styles.meta}>
            Viewing {candles.length.toLocaleString("en-US")} closed {viewTf} candles · {days} days ·
            Binance perp
          </p>
        )}
      </div>

      {analysisError && (
        <div className={styles.state} role="alert">
          <span>{analysisError}</span>
        </div>
      )}
      {!analysisError && behind > 0 && (
        <p className={styles.note} role="status">
          Analysis is {behind} closed {selTf} candle{behind === 1 ? "" : "s"} behind: the analysis
          service can't reach Binance's live API, so it uses the public archive (published daily).
        </p>
      )}

      <div className={styles.ws}>
        <div className={styles.col}>
          <div className={styles.chartCard} ref={chartCardRef}>
            <ChartToolbar
              symbol={symbol}
              symbols={symbols}
              onSymbol={(sym) => navigate(`/chart/${sym}`)}
              lastPrice={live ? price(live.close) : last ? price(last.close) : null}
              viewTf={viewTf}
              onTf={setViewTf}
              favorites={prefs.favorites}
              onToggleFavorite={(tf) =>
                setPrefs({
                  ...prefs,
                  favorites: prefs.favorites.includes(tf)
                    ? prefs.favorites.filter((f) => f !== tf)
                    : [...prefs.favorites, tf],
                })
              }
              chartType={prefs.chartType}
              onChartType={(chartType) => setPrefs({ ...prefs, chartType })}
              onIndicators={() => setDialog({ kind: "indicators" })}
              layers={layers}
              onLayer={(k) => setLayers((l) => ({ ...l, [k]: !l[k] }))}
              scale={prefs.scale}
              onScale={(scale) => setPrefs({ ...prefs, scale })}
              onScreenshot={screenshot}
              onFullscreen={() => void chartCardRef.current?.requestFullscreen?.()}
            />
            {view.loading && (
              <div className={styles.state}>
                Loading {viewTf} history for {symbol}…
              </div>
            )}
            {view.error && (
              <div className={styles.state} role="alert">
                <span>
                  Couldn't load {symbol} history: {view.error}. Binance's public API (or the
                  analysis service) must be reachable from this browser.
                </span>
                <button type="button" className={styles.btn} onClick={retry}>
                  Try again
                </button>
              </div>
            )}
            <div className={styles.chartWithTools}>
              <DrawingToolbar
                tool={tool}
                onTool={setTool}
                magnet={magnet}
                onMagnet={() => setMagnet((m) => !m)}
                visible={drawingsVisible}
                onVisible={() => setDrawingsVisible((v) => !v)}
                onClear={() => chartHandle.current?.clearDrawings()}
              />
              <PriceChart
                symbol={symbol}
                candles={candles}
                viewTf={viewTf}
                live={live}
                chartType={prefs.chartType}
                scale={prefs.scale}
                indicators={indicators}
                onIndicator={onIndicator}
                levels={viewLevels}
                heatmap={heatmap}
                selected={viewSelected}
                plan={selected ? selected.occ : null}
                others={viewOthers}
                markers={markers}
                layers={layers}
                tool={tool}
                onToolChange={setTool}
                magnet={magnet}
                drawingsVisible={drawingsVisible}
                handleRef={chartHandle}
              />
            </div>
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
                <i style={{ border: "1px dashed #4C9AFF" }} />
                Order block
              </span>
              <span>
                <i style={{ background: "rgba(76,154,255,.5)" }} />
                Volume by price
              </span>
              {layers.heatmap && (
                <span>
                  <i style={{ background: "linear-gradient(90deg,#1b2a4a,#f0a35e)" }} />
                  Resting liquidity (order book)
                </span>
              )}
              <span>▲ W / L = past outcomes of the selected setup</span>
            </div>
          </div>

          {layers.heatmap && <LiquidityPanel liquidity={liquidity} pools={pools} />}

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
                <h2 id="zones-title">
                  <TfBadge tf={levelTf} /> Zones and order blocks
                </h2>
                <Explain title="Zones and order blocks">
                  A demand/supply zone is a base of small candles right before a strong departure.
                  An order block is the last opposite candle before a move that broke market
                  structure. Both are known only once that move closed. Fresh = not traded back into
                  yet; a close through the far edge ends it.
                </Explain>
                <p>Intact levels nearest to price first, then the most recently broken.</p>
              </div>
              <div className={styles.xs}>
                <table className={styles.tbl}>
                  <thead>
                    <tr>
                      <th>Level</th>
                      <th className={styles.r}>Range</th>
                      <th className={styles.r}>Strength</th>
                      <th>State</th>
                    </tr>
                  </thead>
                  <tbody>
                    {levelsShown.map((z) => (
                      <tr key={z.id}>
                        <td>
                          <Chip tone={z.kind === "demand" || z.kind === "bullish" ? "up" : "down"}>
                            {LEVEL_LABEL[z.kind]}
                          </Chip>
                        </td>
                        <td className={`${styles.r} ${styles.num}`}>
                          {price(z.low)}–{price(z.high)}
                        </td>
                        <td className={`${styles.r} ${styles.mute}`}>{z.strength}</td>
                        <td className={styles.mute}>
                          {z.end === null ? z.state : `broke ${shortDate(z.end)}`}
                        </td>
                      </tr>
                    ))}
                    {levelsShown.length === 0 && (
                      <tr>
                        <td colSpan={4} className={styles.mute}>
                          {selAnalysis
                            ? "No zones or order blocks in this history."
                            : "Waiting for the analysis service…"}
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
          <DetectionSettings config={config} onChange={setConfig} catalog={catalog} />
          <section className={styles.card} aria-labelledby="pat-title">
            <div className={styles.cardHead}>
              <h2 id="pat-title">Patterns on this chart</h2>
              <p>Most recent first. Pick one to see its record.</p>
              <span className={styles.toolGroup} role="group" aria-label="Show patterns found on">
                Found on
                {DETECTION_TFS.map((tf) => (
                  <button
                    key={tf}
                    type="button"
                    className={styles.tog}
                    aria-pressed={showTf[tf]}
                    aria-label={`Show patterns found on ${tf}`}
                    onClick={() => setShowTf((m) => ({ ...m, [tf]: !m[tf] }))}
                  >
                    <TfBadge tf={tf} />
                  </button>
                ))}
              </span>
            </div>
            <ul className={styles.patList}>
              {recent.map((f) => {
                const st =
                  f.tf === selTf && f.zoneTf === selZoneTf ? statsMap.get(keyOf(f.occ)) : undefined;
                return (
                  <li key={foundId(f)}>
                    <button
                      type="button"
                      aria-pressed={selected !== null && foundId(f) === foundId(selected)}
                      onClick={() => setSelId(foundId(f))}
                    >
                      <b>
                        <TfBadge tf={f.tf} />{" "}
                        <span className={f.occ.direction === "long" ? styles.up : styles.down}>
                          {f.occ.direction === "long" ? "▲" : "▼"}
                        </span>{" "}
                        {patternLabel(f.occ.pattern)}{" "}
                        <span className={styles.mute}>
                          {locationLabel(f.occ.location, f.occ.direction)}
                        </span>
                      </b>
                      <span className={styles.num}>{st ? pct(st.winRate) : ""}</span>
                      <small>
                        {isNow(f) ? "Now" : shortDate(f.closeTime - 1)}
                        {st ? ` · ${st.n} past cases` : ""}
                      </small>
                    </button>
                  </li>
                );
              })}
              {analyses.size > 0 && recent.length === 0 && (
                <li className={styles.mute}>
                  No patterns found on the selected timeframes in this history.
                </li>
              )}
              {analysisLoading && analyses.size === 0 && (
                <li className={styles.mute}>Detecting patterns…</li>
              )}
              {catalog && patternTfs.length === 0 && (
                <li className={styles.mute}>
                  Every pattern is switched off in Detection settings.
                </li>
              )}
            </ul>
          </section>
          {selected && (
            <SetupCard
              occurrence={selected.occ}
              interval={selected.tf}
              zoneTf={selected.zoneTf}
              isCurrent={isNow(selected)}
              pooled={pooled}
              baseline={baseline}
              own={own}
              recent={detail?.recent ?? []}
              run={ctxStats.data?.run ?? null}
              statsError={ctxStats.error}
              ruleset={catalog?.ruleset ?? null}
              maxHoldBars={catalog?.maxHoldBars ?? 30}
              minSample={catalog?.minSample ?? 30}
              checks={checks}
            />
          )}
        </aside>
      </div>
      {dialog?.kind === "indicators" && (
        <IndicatorsDialog
          onAdd={addIndicator}
          onClose={() => setDialog(null)}
          counts={indicators.reduce<Record<string, number>>(
            (m, i) => ({ ...m, [i.id]: (m[i.id] ?? 0) + 1 }),
            {},
          )}
        />
      )}
      {dialog?.kind === "settings" &&
        (() => {
          const inst = indicators.find((i) => i.uid === dialog.uid);
          return inst ? (
            <IndicatorSettings
              inst={inst}
              onSave={(next) =>
                setIndicators(indicators.map((i) => (i.uid === next.uid ? next : i)))
              }
              onClose={() => setDialog(null)}
            />
          ) : null;
        })()}
    </main>
  );
};

export default ChartPage;
