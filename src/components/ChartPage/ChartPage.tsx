import { useMemo, useRef, useState } from "react";
import type { DrawingKind } from "lightweight-charts-drawing";
import { useNavigate, useParams } from "react-router-dom";
import type { CandleInterval } from "../../types/marketData";
import type { AnalysisOut } from "../../api/schema";
import { useHistories } from "../../custom-hooks/useHistories";
import { researchUniverse } from "../../custom-hooks/useUniverseCandles";
import { useAnalysis, useCatalog } from "../../custom-hooks/useAnalysisApi";
import { useUniverseCandles } from "../../custom-hooks/useUniverseCandles";
import { latestPatterns, MIN_CHECKS, viewTfFor } from "../../utils/patternList";
import { loadWatchlist, saveWatchlist } from "../../utils/watchlistStorage";
import { price } from "../../utils/format";
import {
  loadDetection,
  saveDetection,
  pickedKeys,
  pickKey,
  type DetectionConfig,
} from "../../utils/detectionConfig";
import { TF_MS, toViewLevels, toViewPattern, type ViewPattern } from "../../utils/timeframeMapping";
import PriceChart, { type ChartHandle, type IndicatorAction, type Layers } from "./PriceChart";
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
  const a15m = useAnalysis(patternTfs.includes("15m") ? symbol : null, "15m", "15m");
  const a1h = useAnalysis(patternTfs.includes("1h") ? symbol : null, "1h", "1h");
  const a4h = useAnalysis(patternTfs.includes("4h") ? symbol : null, "4h", "4h");
  const a1d = useAnalysis(patternTfs.includes("1d") ? symbol : null, "1d", "1d");
  const analyses = useMemo(() => {
    const out = new Map<CandleInterval, AnalysisOut>();
    if (a15m.data) out.set("15m", a15m.data);
    if (a1h.data) out.set("1h", a1h.data);
    if (a4h.data) out.set("4h", a4h.data);
    if (a1d.data) out.set("1d", a1d.data);
    return out;
  }, [a15m.data, a1h.data, a4h.data, a1d.data]);
  const analysisError = [a15m, a1h, a4h, a1d].find((a) => a.error)?.error ?? null;
  const analysisLoading = [a15m, a1h, a4h, a1d].some((a) => a.loading && !a.data);

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

  // The list and the chart: the last 10 detections meeting at least 3 of 6 checks.
  const recent = useMemo(() => latestPatterns(found), [found]);
  const selected = recent.find((f) => foundId(f) === openId) ?? recent[0] ?? null;
  const selTf = selected?.tf ?? patternTfs[0] ?? "4h";
  const selZoneTf = selected?.zoneTf ?? selTf;
  const selAnalysis = analyses.get(selTf) ?? analyses.values().next().value ?? null;

  const needed = useMemo(() => [viewTf], [viewTf]);
  const hist = useHistories(symbol, needed, attempt);
  const view = hist.get(viewTf)!;
  const liveFeed = useLiveCandle(symbol, viewTf);
  const live = liveFeed.candle;
  const candles = view.candles;

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
  const levelTf = (selAnalysis?.zoneTf ?? selZoneTf) as CandleInterval;
  // Only the key levels are drawn (Overlays → Display settings); every level still
  // counts for the setups' locations.
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
              focusKey={focus ? `${focus.id}#${focus.n}` : null}
              others={viewOthers}
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
          items={recent}
          idOf={foundId}
          openId={selected ? foundId(selected) : null}
          onOpen={(f) => {
            // A pattern from a lower timeframe than the chart's: show it on its own timeframe
            // (once, on this click; the user can switch back).
            setViewTf(viewTfFor(f.tf, viewTf, TF_MS));
            setOpenId(foundId(f));
            setFocus((p) => ({ id: foundId(f), n: (p?.n ?? 0) + 1 }));
          }}
          isNow={isNow}
          ruleset={catalog?.ruleset ?? null}
          loading={analysisLoading && analyses.size === 0}
          empty={
            catalog && patternTfs.length === 0
              ? "No timeframe picked: open Patterns in the chart toolbar."
              : `No pattern with ${MIN_CHECKS} or more of 6 checks on the picked timeframes in this history.`
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
