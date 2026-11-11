import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DrawingKind } from "lightweight-charts-drawing";
import { useNavigate, useParams } from "react-router-dom";
import { CANDLE_INTERVALS, type Candle, type CandleInterval } from "../../types/marketData";
import type { SetupOccurrence } from "../../types/analysis";
import { useHistories } from "../../custom-hooks/useHistories";
import { useSetupStats } from "../../custom-hooks/useSetupStats";
import { researchUniverse } from "../../custom-hooks/useScan";
import { analyzeSymbol, LOCATION_LABELS, setupKey, summarize } from "../../utils/setupAnalysis";
import { PATTERN_LABELS } from "../../utils/patterns";
import { computeVolumeProfile } from "../../utils/volumeProfile";
import { ema, sma } from "../../utils/indicators";
import { pct, price, shortDate } from "../../utils/format";
import {
  activeTfs,
  DETECTION_TFS,
  loadDetection,
  saveDetection,
  zoneTfFor,
  type DetectionConfig,
} from "../../utils/detectionConfig";
import {
  TF_MS,
  toViewPattern,
  toViewZones,
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
import { useLiveCandle } from "../../custom-hooks/useLiveCandle";
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
import PatternLibrary, { PatternLibraryCard } from "../PatternLibrary";
import { usePatternLibrary } from "../../custom-hooks/usePatternLibrary";
import type { LibraryEvent, LibraryKind } from "../../types/patternLibrary";
import { indexStats, libraryMarkers, statsKey } from "../../utils/patternLibrary";
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
const foundId = (f: Found) => `${f.tf}-${f.occ.hit.type}-${f.occ.hit.index}`;
const NO_CANDLES: Candle[] = [];

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
  const [layers, setLayers] = useState<Layers>({ zones: true, vp: true, pattern: true });
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

  // Pattern library (Python backend, ta_patterns) on the view timeframe. A pick belongs to
  // one symbol x timeframe x kind, so switching any of them clears it without an effect.
  const [libKind, setLibKind] = useState<LibraryKind>("chart");
  const lib = usePatternLibrary(symbol, viewTf, libKind);
  const libScope = `${symbol}|${viewTf}|${libKind}`;
  const [libPick, setLibPick] = useState<{ scope: string; event: LibraryEvent } | null>(null);
  const libSel = libPick?.scope === libScope ? libPick.event : null;
  const selectLib = (event: LibraryEvent | null) =>
    setLibPick(event ? { scope: libScope, event } : null);

  // Every timeframe needed: the view, each pattern timeframe and its zone source.
  const patternTfs = useMemo(() => activeTfs(config), [config]);
  const needed = useMemo(() => {
    const set = new Set<CandleInterval>([viewTf]);
    for (const tf of patternTfs) {
      set.add(tf);
      set.add(zoneTfFor(tf, config.zones));
    }
    return CANDLE_INTERVALS.filter((tf) => set.has(tf));
  }, [viewTf, patternTfs, config.zones]);
  const hist = useHistories(symbol, needed, attempt);
  const view = hist.get(viewTf)!;
  const live = useLiveCandle(symbol, viewTf);
  const candles = view.candles;
  const candlesOf = useCallback(
    (tf: CandleInterval) => hist.get(tf)?.candles ?? NO_CANDLES,
    [hist],
  );

  // Detect on each pattern timeframe, with zones from its configured source.
  const analyses = useMemo(() => {
    const out = new Map<CandleInterval, ReturnType<typeof analyzeSymbol>>();
    for (const tf of patternTfs) {
      const zoneTf = zoneTfFor(tf, config.zones);
      const pc = candlesOf(tf);
      const zc = candlesOf(zoneTf);
      if (pc.length === 0 || zc.length === 0) continue;
      out.set(
        tf,
        analyzeSymbol(
          symbol,
          pc,
          zoneTf === tf ? undefined : { candles: zc, patternMs: TF_MS[tf], zoneMs: TF_MS[zoneTf] },
        ),
      );
    }
    return out;
  }, [symbol, patternTfs, config.zones, candlesOf]);

  const found: Found[] = useMemo(() => {
    const out: Found[] = [];
    for (const [tf, a] of analyses) {
      const pc = candlesOf(tf);
      for (const occ of a.occurrences) {
        if (!config.patterns[occ.hit.type].includes(tf)) continue;
        out.push({
          occ,
          tf,
          zoneTf: zoneTfFor(tf, config.zones),
          closeTime: pc[occ.hit.index].openTime + TF_MS[tf],
        });
      }
    }
    return out.sort((x, y) => y.closeTime - x.closeTime);
  }, [analyses, config, candlesOf]);

  const recent = useMemo(() => found.filter((f) => showTf[f.tf]).slice(0, 10), [found, showTf]);
  const selected = recent.find((f) => foundId(f) === selId) ?? recent[0] ?? null;
  const selTf = selected?.tf ?? viewTf;
  const selCandles = candlesOf(selTf);
  const key = selected ? setupKey(selected.occ.hit.type, selected.occ.location) : null;

  // Pooled statistics: the selected setup's context first, every other one in the background.
  const stats = useSetupStats();
  const selPatternTf = selected?.tf;
  const selZoneTf = selected?.zoneTf;
  const ctx = useMemo(
    () => (selPatternTf && selZoneTf ? { patternTf: selPatternTf, zoneTf: selZoneTf } : null),
    [selPatternTf, selZoneTf],
  );
  useEffect(() => {
    if (ctx) stats.request(ctx, true);
    for (const tf of DETECTION_TFS)
      stats.request({ patternTf: tf, zoneTf: zoneTfFor(tf, config.zones) });
  }, [stats, ctx, config.zones]);
  const ctxStats = ctx ? stats.get(ctx) : null;
  const pooled = key && ctxStats ? (ctxStats.pooled.get(key) ?? null) : null;

  // This coin only, same setup and timeframe; and its past cases for the chart markers.
  const history = useMemo(
    () =>
      selected
        ? (analyses.get(selected.tf)?.occurrences ?? []).filter(
            (o) => o.hit.type === selected.occ.hit.type && o.location === selected.occ.location,
          )
        : [],
    [analyses, selected],
  );
  const ownStats = useMemo(
    () =>
      selected && history.length
        ? summarize(selected.occ.hit.type, selected.occ.location, history)
        : null,
    [selected, history],
  );

  // Everything drawn on the chart, mapped onto the view timeframe.
  const viewSelected: ViewPattern | null = useMemo(
    () =>
      selected && candles.length && selCandles.length
        ? toViewPattern(selected.occ, selected.tf, selCandles, candles, viewTf)
        : null,
    [selected, selCandles, candles, viewTf],
  );
  const viewOthers = useMemo(
    () =>
      candles.length
        ? recent
            .filter((f) => f !== selected)
            .map((f) => toViewPattern(f.occ, f.tf, candlesOf(f.tf), candles, viewTf))
        : [],
    [recent, selected, candles, viewTf, candlesOf],
  );
  const libStats = useMemo(() => indexStats(lib.entry?.stats?.stats ?? []), [lib.entry]);
  const libMarkerList: ViewMarker[] | null = useMemo(() => {
    if (!libSel || !candles.length) return null;
    const cases = libStats.get(statsKey(libSel.pattern, libSel.direction))?.recent ?? [];
    return libraryMarkers(cases, libSel, candles);
  }, [libSel, libStats, candles]);
  const libPlan = useMemo(
    () => (libSel ? { entry: libSel.entry, stop: libSel.stop, target: libSel.target } : null),
    [libSel],
  );
  const markers: ViewMarker[] = useMemo(() => {
    if (libMarkerList) return libMarkerList;
    if (!selected || !candles.length) return [];
    return history.flatMap((o) => {
      const time = viewBarTimeForClose(
        candles,
        selCandles[o.hit.index].openTime,
        TF_MS[selected.tf],
      );
      return time === null ? [] : [{ time, result: o.outcome.result, current: o === selected.occ }];
    });
  }, [libMarkerList, history, selected, selCandles, candles]);

  // Zones shown: those the selected setup was located with (else the view's own source).
  const zoneTf = selected?.zoneTf ?? zoneTfFor(viewTf, config.zones);
  const zoneCandles = candlesOf(zoneTf);
  const zoneList = useMemo(
    () =>
      analyses.get(selTf)?.zones ??
      (zoneCandles.length ? analyzeSymbol(symbol, zoneCandles).zones : []),
    [analyses, selTf, zoneCandles, symbol],
  );
  const viewZones = useMemo(
    () =>
      candles.length && zoneCandles.length
        ? toViewZones(zoneList, zoneTf, zoneCandles, candles, viewTf)
        : [],
    [zoneList, zoneTf, zoneCandles, candles, viewTf],
  );

  const profile = useMemo(() => computeVolumeProfile(candles.slice(-200), 48), [candles]);
  // EMA 50 and 20-candle volume on the pattern's timeframe, for the confluence checks.
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

  // Confluence checks on the pattern's own timeframe.
  const checks: Check[] = useMemo(() => {
    if (!selected || selCandles.length === 0) return [];
    const i = selected.occ.hit.index;
    const cs = selCandles;
    const out: Check[] = [];
    out.push(
      selected.occ.location === "demandZone"
        ? { ok: true, text: `Pattern low sits inside an intact ${selected.zoneTf} demand zone` }
        : { ok: false, text: `Not at a ${selected.zoneTf} demand zone (open space)` },
    );
    const avgVol = context.vol20[i - 1];
    if (Number.isFinite(avgVol) && avgVol > 0) {
      const ratio = cs[i].volume / avgVol;
      out.push({
        ok: ratio >= 1.2,
        text: `Confirmation candle on ${ratio.toFixed(1)}× the 20-candle average volume`,
      });
    }
    const e = context.ema50[i];
    if (Number.isFinite(e)) {
      out.push(
        cs[i].close > e
          ? { ok: true, text: `Above EMA 50 (${selected.tf}): with the trend` }
          : { ok: false, text: `Below EMA 50 (${selected.tf}): against the trend` },
      );
    }
    const prior = computeVolumeProfile(cs.slice(Math.max(0, i - 200), i + 1), 48);
    if (prior) {
      out.push(
        selected.occ.hit.entry > prior.pocPrice
          ? { ok: true, text: `Entry above the point of control (${price(prior.pocPrice)})` }
          : {
              ok: false,
              text: `Entry below the point of control (${price(prior.pocPrice)}): volume overhead`,
            },
      );
    }
    return out;
  }, [selected, selCandles, context]);

  // Intact zones nearest to the current price first, then the most recently broken.
  const zonesShown = useMemo(() => {
    if (zoneCandles.length === 0) return [];
    const px = zoneCandles[zoneCandles.length - 1].close;
    const dist = (z: { low: number; high: number }) => Math.abs((z.low + z.high) / 2 - px);
    const intact = zoneList.filter((z) => z.endIndex === null).sort((a, b) => dist(a) - dist(b));
    const broken = zoneList
      .filter((z) => z.endIndex !== null)
      .sort((a, b) => (b.endIndex ?? 0) - (a.endIndex ?? 0));
    return [...intact.slice(0, 5), ...broken.slice(0, 2)];
  }, [zoneList, zoneCandles]);

  const progress = DETECTION_TFS.map((tf) => {
    const c = { patternTf: tf, zoneTf: zoneTfFor(tf, config.zones) };
    return { label: `${tf} patterns · ${c.zoneTf} zones`, stats: stats.get(c) };
  });

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
          <p>
            Patterns found on every timeframe you pick in Detection settings, drawn on the timeframe
            you view, with the history of every setup.
          </p>
        </div>
        {candles.length > 0 && (
          <p className={styles.meta}>
            Viewing {candles.length.toLocaleString("en-US")} closed {viewTf} candles · {days} days ·
            Binance perp
          </p>
        )}
      </div>

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
                Loading {viewTf} history for {symbol} from Binance…
              </div>
            )}
            {view.error && (
              <div className={styles.state} role="alert">
                <span>
                  Couldn't load {symbol} history: {view.error}. Check your connection; Binance's
                  public API must be reachable from this browser.
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
                zones={viewZones}
                selected={libSel ? null : viewSelected}
                plan={libSel ? libPlan : selected ? selected.occ.hit : null}
                others={viewOthers}
                markers={markers}
                focusTime={libSel?.open_time ?? null}
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
                <i style={{ background: "rgba(76,154,255,.5)" }} />
                Volume by price
              </span>
              <span>Shaded blocks = the higher-timeframe candles of the selected pattern</span>
              <span>▲ / ▼ W / L = past outcomes of the selected setup (▼ = short)</span>
            </div>
          </div>

          {libSel && (
            <PatternLibraryCard
              symbol={symbol}
              interval={viewTf}
              entry={lib.entry}
              selected={libSel}
              onSelect={selectLib}
            />
          )}

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
                  <TfBadge tf={zoneTf} /> Zones
                </h2>
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
                            : `broke ${shortDate(zoneCandles[z.endIndex].openTime)}`}
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
          <PatternLibrary
            symbol={symbol}
            interval={viewTf}
            kind={libKind}
            onKind={setLibKind}
            entry={lib.entry}
            onRetry={lib.retry}
            selected={libSel}
            onSelect={selectLib}
          />
          <DetectionSettings config={config} onChange={setConfig} progress={progress} />
          <section className={styles.card} aria-labelledby="pat-title">
            <div className={styles.cardHead}>
              <h2 id="pat-title">Patterns on this chart</h2>
              <p>Most recent first. Pick one to see its history.</p>
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
                const st = stats
                  .get({ patternTf: f.tf, zoneTf: f.zoneTf })
                  ?.pooled.get(setupKey(f.occ.hit.type, f.occ.location));
                const isNow = f.occ.hit.index >= candlesOf(f.tf).length - 3;
                return (
                  <li key={foundId(f)}>
                    <button
                      type="button"
                      aria-pressed={
                        !libSel && selected !== null && foundId(f) === foundId(selected)
                      }
                      onClick={() => {
                        setSelId(foundId(f));
                        selectLib(null);
                      }}
                    >
                      <b>
                        <TfBadge tf={f.tf} /> {PATTERN_LABELS[f.occ.hit.type]}{" "}
                        <span className={styles.mute}>
                          {f.occ.location === "demandZone"
                            ? `in ${f.zoneTf} demand zone`
                            : LOCATION_LABELS[f.occ.location]}
                        </span>
                      </b>
                      <span className={styles.num}>{st ? pct(st.winRate) : "…"}</span>
                      <small>
                        {isNow ? "Now" : shortDate(f.closeTime - 1)} ·{" "}
                        {st ? `${st.n} past cases` : "measuring…"}
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
              {patternTfs.length === 0 && (
                <li className={styles.mute}>
                  Every pattern is switched off in Detection settings.
                </li>
              )}
            </ul>
            {ctxStats && ctxStats.failed.length > 0 && (
              <p className={styles.note}>
                Pooled without {ctxStats.failed.join(", ")} (history failed to load).{" "}
                <button type="button" className={styles.link} onClick={retry}>
                  Retry
                </button>
              </p>
            )}
          </section>
          {selected && !libSel && (
            <SetupCard
              occurrence={selected.occ}
              interval={selected.tf}
              zoneTf={selected.zoneTf}
              isCurrent={selected.occ.hit.index >= selCandles.length - 3}
              pooled={pooled}
              own={ownStats}
              coins={ctxStats ? ctxStats.total - ctxStats.failed.length : universe.length}
              pooling={!ctxStats || ctxStats.state !== "done"}
              measured={ctxStats ? { done: ctxStats.done, total: ctxStats.total } : undefined}
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
