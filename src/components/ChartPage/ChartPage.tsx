import { useMemo, useRef, useState } from "react";
import type { DrawingKind } from "lightweight-charts-drawing";
import { useNavigate, useParams } from "react-router-dom";
import type { CandleInterval } from "../../types/marketData";
import type { AnalysisOut } from "../../api/schema";
import type { SetupOccurrence } from "../../types/analysis";
import { useHistories } from "../../custom-hooks/useHistories";
import { researchUniverse } from "../../custom-hooks/useUniverseCandles";
import { useAnalysis, useCatalog, useCoinStats } from "../../custom-hooks/useAnalysisApi";
import { useUniverseCandles } from "../../custom-hooks/useUniverseCandles";
import { setupKey } from "../../utils/setupKeys";
import { statsByKey } from "../../utils/setupLibrary";
import { groupDetections } from "../../utils/patternGroups";
import { loadWatchlist, saveWatchlist } from "../../utils/watchlistStorage";
import type { SetupStats } from "../../types/analysis";
import { price } from "../../utils/format";
import {
  DETECTION_TFS,
  loadDetection,
  saveDetection,
  pickedKeys,
  pickKey,
  type DetectionConfig,
} from "../../utils/detectionConfig";
import {
  TF_MS,
  toViewLevels,
  toViewPattern,
  viewBarTimeForClose,
  type ViewPattern,
} from "../../utils/timeframeMapping";
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
import OverlaySettingsDialog from "./OverlaySettingsDialog";
import {
  keyLevels,
  OVERLAYS_STORAGE_KEY,
  parseOverlays,
  type OverlaySettings,
} from "../../utils/overlaySettings";
import LiquidityPanel from "./LiquidityPanel";
import { useLiveCandle } from "../../custom-hooks/useLiveCandle";
import { useLiquidity } from "../../custom-hooks/useLiquidity";
import { useBigTrades } from "../../custom-hooks/useBigTrades";
import { useFootprint } from "../../custom-hooks/useFootprint";
import { autoStep } from "../../utils/footprint";
import { formatCompactUsd } from "../../utils/priceUtils";
import { liquidityPools, mergeSamples } from "../../utils/liquidityHeatmap";
import { useDepthHistory } from "../../custom-hooks/useDepthHistory";
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
import DetectionSettings, { detectionSummary } from "./DetectionSettings";
import PatternRows, { type Found } from "./PatternRows";
import WatchlistStrip from "./WatchlistStrip";
import styles from "./ChartPage.module.scss";

const foundId = (f: Found) => `${f.tf}-${f.occ.pattern}-${f.occ.direction}-${f.occ.time}`;
/** Records are read at any location: the app no longer splits setups by zone / order block. */
const keyOf = (o: Pick<SetupOccurrence, "pattern" | "direction">) =>
  setupKey(o.pattern, o.direction, "*");

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
  const [attempt, setAttempt] = useState(0);
  const [overlays, setOverlaysState] = useState<OverlaySettings>(() =>
    loadJson(OVERLAYS_STORAGE_KEY, parseOverlays),
  );
  const setOverlays = (next: OverlaySettings) => {
    setOverlaysState(next);
    saveJson(OVERLAYS_STORAGE_KEY, next);
  };
  const layers: Layers = overlays;
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
    { kind: "indicators" } | { kind: "overlays" } | { kind: "settings"; uid: string } | null
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

  // The Dashboard's watchlist, as chips above the chart (1h candles for the 24 h change).
  const [watchlist, setWatchlistState] = useState<string[]>(() => loadWatchlist());
  const toggleWatch = () => {
    const next = watchlist.includes(symbol)
      ? watchlist.filter((s) => s !== symbol)
      : [...watchlist, symbol];
    setWatchlistState(next);
    saveWatchlist(next);
  };
  const watchCandles = useUniverseCandles(watchlist, "1h").candles;

  // The open pattern row (`pattern|direction`); its newest detection is drawn.
  const [openId, setOpenId] = useState<string | null>(null);
  // Bumped on every click, so picking the same pattern again scrolls back to it.
  const [focus, setFocus] = useState<{ id: string; n: number } | null>(null);

  // The rule set lives in the backend: patterns, zones and order blocks per detection timeframe.
  const catalog = useCatalog().data;
  const patternTfs = config.tfs;
  // Zones and order blocks come from the pattern's own timeframe.
  const a1h = useAnalysis(patternTfs.includes("1h") ? symbol : null, "1h", "1h");
  const a4h = useAnalysis(patternTfs.includes("4h") ? symbol : null, "4h", "4h");
  const a1d = useAnalysis(patternTfs.includes("1d") ? symbol : null, "1d", "1d");
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
    const visible = pickedKeys(config, catalog); // the patterns picked in the Patterns panel
    for (const [tf, a] of analyses) {
      for (const occ of a.occurrences) {
        if (!visible.has(pickKey(occ.pattern, occ.direction))) continue;
        out.push({
          occ: { ...occ, symbol },
          pattern: occ.pattern,
          direction: occ.direction,
          tf,
          zoneTf: a.zoneTf as CandleInterval,
          closeTime: occ.time + TF_MS[tf],
        });
      }
    }
    return out.sort((x, y) => y.closeTime - x.closeTime);
  }, [analyses, catalog, config, symbol]);

  const recent = useMemo(() => found.slice(0, 12), [found]);
  const groups = useMemo(() => groupDetections(found, DETECTION_TFS), [found]);
  const openGroup = groups.find((g) => g.id === openId) ?? groups[0] ?? null;
  const selected = openGroup?.latest ?? null;
  const selTf = selected?.tf ?? patternTfs[0] ?? "4h";
  const selZoneTf = selected?.zoneTf ?? selTf;
  const selAnalysis = analyses.get(selTf) ?? analyses.values().next().value ?? null;

  const needed = useMemo(() => [viewTf], [viewTf]);
  const hist = useHistories(symbol, needed, attempt);
  const view = hist.get(viewTf)!;
  const liveFeed = useLiveCandle(symbol, viewTf);
  const live = liveFeed.candle;
  const candles = view.candles;

  // This coin's own record of every setup per timeframe (background job, one to two years).
  const c1h = useCoinStats(patternTfs.includes("1h") ? symbol : null, "1h");
  const c4h = useCoinStats(patternTfs.includes("4h") ? symbol : null, "4h");
  const c1d = useCoinStats(patternTfs.includes("1d") ? symbol : null, "1d");
  const coinStats = useMemo(() => {
    const out = new Map<CandleInterval, Map<string, SetupStats>>();
    if (c1h.data) out.set("1h", statsByKey(c1h.data));
    if (c4h.data) out.set("4h", statsByKey(c4h.data));
    if (c1d.data) out.set("1d", statsByKey(c1d.data));
    return out;
  }, [c1h.data, c4h.data, c1d.data]);
  const selStats = selTf === "1h" ? c1h : selTf === "1d" ? c1d : c4h;
  const key = selected ? keyOf(selected.occ) : null;

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
            .slice(0, overlays.patternTags)
            .map((f) => toViewPattern(f.occ, f.tf, candles, viewTf))
        : [],
    [recent, selected, candles, viewTf, overlays.patternTags],
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
  // Only the key levels are drawn (Overlays → Display settings); every level still
  // counts for the setups' locations and statistics.
  const lastClose = candles.length ? candles[candles.length - 1].close : null;
  const shown = useMemo(
    () => (selAnalysis && lastClose !== null ? keyLevels(selAnalysis, lastClose, overlays) : null),
    [selAnalysis, lastClose, overlays],
  );
  const viewLevels = useMemo(
    () => (shown && candles.length ? toViewLevels(shown, levelTf, candles, viewTf) : []),
    [shown, levelTf, candles, viewTf],
  );

  const behind = selAnalysis?.coverage.behind ?? 0;

  // Order-book liquidity (only while the heatmap layer is on: no sockets otherwise).
  const depthHistory = useDepthHistory(layers.heatmap ? symbol : null);
  const liquidity = useLiquidity(layers.heatmap ? symbol : null);
  // Big taker orders (only while the layer is on).
  const bigTrades = useBigTrades(layers.bigTrades ? symbol : null);
  // Footprint rows sized from recent candles (about 12 rows per typical candle).
  const footprintStep = useMemo(() => autoStep(view.candles), [view.candles]);
  const footprint = useFootprint(layers.footprint ? symbol : null, TF_MS[viewTf], footprintStep);
  // Recorded history (analysis service) followed by this tab's live samples.
  const depthSamples = useMemo(
    () => mergeSamples(depthHistory.samples, liquidity.samples),
    [depthHistory.samples, liquidity.samples],
  );
  const heatmap = layers.heatmap ? depthSamples : null;
  const pools = useMemo(() => liquidityPools(depthSamples), [depthSamples]);

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

      <WatchlistStrip
        symbols={watchlist}
        current={symbol}
        candles={watchCandles}
        onToggleCurrent={toggleWatch}
      />

      <div className={styles.col}>
        <div className={styles.chartCard} ref={chartCardRef}>
          <ChartToolbar
            symbol={symbol}
            symbols={symbols}
            onSymbol={(sym) => navigate(`/chart/${sym}`)}
            lastPrice={live ? price(live.close) : last ? price(last.close) : null}
            liveSource={liveFeed.source}
            liveAt={liveFeed.at}
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
            onLayer={(k) => setOverlays({ ...overlays, [k]: !overlays[k] })}
            onDisplaySettings={() => setDialog({ kind: "overlays" })}
            patternsLabel={`Patterns · ${detectionSummary(config, catalog ?? null)}`}
            patterns={
              <DetectionSettings config={config} onChange={setConfig} catalog={catalog ?? null} />
            }
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
                Couldn't load {symbol} history: {view.error}. Binance's public API (or the analysis
                service) must be reachable from this browser.
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
              bigTrades={layers.bigTrades ? bigTrades : null}
              footprint={layers.footprint ? footprint : null}
              selected={viewSelected}
              plan={selected ? selected.occ : null}
              focusKey={focus ? `${focus.id}#${focus.n}` : null}
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
              <span title="Resting limit orders on Binance + OKX + Delta perpetuals added together (±2% of the price), one column per snapshot; brightest = the largest few percent on screen (Display settings → heatmap contrast). Bars at the right edge: the current book, bids green, asks red.">
                <i
                  style={{
                    background:
                      "linear-gradient(90deg,#0c1648,#1634a0,#008cd2,#00c8aa,#5ad746,#f5e132,#fa8c1e,#eb3223,#fff5e6)",
                  }}
                />
                Resting liquidity (order book), thin → thick
              </span>
            )}
            {layers.footprint && (
              <span title="Volume by price inside each candle from Binance perpetual trades since this page opened: aggressive sells (left) × aggressive buys (right). Zoom in for numbers. Coloured edge or text = 3× diagonal imbalance; amber box = most traded row.">
                <i
                  style={{
                    background: "linear-gradient(90deg,rgba(244,112,103,.6),rgba(86,211,100,.6))",
                  }}
                />
                Footprint: sells × buys per {price(footprintStep)} row
                {footprint.trades === 0 ? " (waiting for trades…)" : ""}
              </span>
            )}
            {layers.bigTrades && (
              <span title="Binance perpetual taker orders in the top 1% by size of recent prints, since this page opened. One order split across many fills counts once.">
                <i style={{ background: "rgba(86,211,100,.5)", borderRadius: "50%" }} />
                <i style={{ background: "rgba(244,112,103,.5)", borderRadius: "50%" }} />
                {bigTrades.threshold
                  ? `Big trades ≥ ${formatCompactUsd(bigTrades.threshold)} (bought / sold)`
                  : "Big trades: measuring typical size…"}
              </span>
            )}
            <span>▲ W / L = past outcomes of the selected setup</span>
          </div>
        </div>

        {layers.heatmap && (
          <LiquidityPanel
            liquidity={liquidity}
            pools={pools}
            history={depthHistory}
            since={depthSamples[0]?.time}
          />
        )}

        <PatternRows
          symbol={symbol}
          groups={groups}
          openId={openGroup?.id ?? null}
          onOpen={(g) => {
            setOpenId(g.id);
            setFocus((p) => ({ id: foundId(g.latest), n: (p?.n ?? 0) + 1 }));
          }}
          tfs={patternTfs}
          stats={coinStats}
          isNow={isNow}
          run={selStats.data?.run ?? null}
          statsError={selStats.error}
          ruleset={catalog?.ruleset ?? null}
          maxHoldBars={catalog?.maxHoldBars ?? 30}
          minSample={catalog?.minSample ?? 30}
          loading={analysisLoading && analyses.size === 0}
          empty={
            catalog && patternTfs.length === 0
              ? "No timeframe picked: open Patterns in the chart toolbar."
              : "No patterns found on the picked timeframes in this history."
          }
        />
      </div>
      {dialog?.kind === "overlays" && (
        <OverlaySettingsDialog
          value={overlays}
          onChange={setOverlays}
          onClose={() => setDialog(null)}
        />
      )}
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
