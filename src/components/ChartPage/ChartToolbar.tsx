import { useEffect, useRef, useState } from "react";
import type { CandleInterval } from "../../types/marketData";
import {
  CHART_TYPES,
  TF_GROUPS,
  tfLabel,
  tfLongLabel,
  type ChartType,
  type ScaleMode,
} from "../../utils/chartDisplay";
import type { Layers } from "./PriceChart";
import { Icon } from "./icons";
import styles from "./ChartPage.module.scss";

/** Open state for a popover that closes on outside click or Escape. */
function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (
        e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)
      )
        setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  return { open, setOpen, ref };
}

const LAYERS: [keyof Layers, string][] = [
  ["pattern", "Patterns"],
  ["zones", "Demand / supply zones"],
  ["orderBlocks", "Order blocks"],
  ["fvg", "Fair value gaps"],
  ["vp", "Volume profile"],
  ["heatmap", "Liquidity heatmap"],
];

interface Props {
  symbol: string;
  symbols: string[];
  onSymbol: (s: string) => void;
  lastPrice: string | null;
  viewTf: CandleInterval;
  onTf: (tf: CandleInterval) => void;
  favorites: CandleInterval[];
  onToggleFavorite: (tf: CandleInterval) => void;
  chartType: ChartType;
  onChartType: (t: ChartType) => void;
  onIndicators: () => void;
  layers: Layers;
  onLayer: (k: keyof Layers) => void;
  scale: ScaleMode;
  onScale: (m: ScaleMode) => void;
  onScreenshot: () => void;
  onFullscreen: () => void;
}

/** TradingView-style top toolbar. */
const ChartToolbar: React.FC<Props> = (p) => {
  const { open: tfOpen, setOpen: setTfOpen, ref: tfRef } = usePopover();
  const { open: typeOpen, setOpen: setTypeOpen, ref: typeRef } = usePopover();
  const { open: layerOpen, setOpen: setLayerOpen, ref: layerRef } = usePopover();
  const favs = p.favorites.includes(p.viewTf) ? p.favorites : [...p.favorites, p.viewTf];
  const ordered = TF_GROUPS.flatMap((g) => g.tfs).filter((tf) => favs.includes(tf));

  return (
    <div className={styles.tvBar} role="toolbar" aria-label="Chart controls">
      <label className="sr-only" htmlFor="chart-symbol">
        Symbol
      </label>
      <select
        id="chart-symbol"
        className={styles.symbol}
        value={p.symbol}
        onChange={(e) => p.onSymbol(e.target.value)}
      >
        {p.symbols.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      {p.lastPrice && <span className={styles.lastPx}>{p.lastPrice}</span>}
      <span className={styles.sep} aria-hidden="true" />

      <div className={styles.tfGroup} role="group" aria-label="Timeframe">
        {ordered.map((tf) => (
          <button
            key={tf}
            type="button"
            className={styles.tbBtn}
            aria-pressed={tf === p.viewTf}
            title={tfLongLabel(tf)}
            onClick={() => p.onTf(tf)}
          >
            {tfLabel(tf)}
          </button>
        ))}
        <div className={styles.dd} ref={tfRef}>
          <button
            type="button"
            className={styles.tbBtn}
            aria-expanded={tfOpen}
            aria-label="All timeframes"
            onClick={() => setTfOpen((o) => !o)}
          >
            <Icon name="chevron" size={14} />
          </button>
          {tfOpen && (
            <div className={styles.menu} role="menu">
              {TF_GROUPS.map((g) => (
                <div key={g.label}>
                  <div className={styles.menuHead}>{g.label}</div>
                  {g.tfs.map((tf) => (
                    <div key={tf} className={styles.menuRow}>
                      <button
                        type="button"
                        role="menuitemradio"
                        aria-checked={tf === p.viewTf}
                        className={styles.menuItem}
                        onClick={() => {
                          p.onTf(tf);
                          setTfOpen(false);
                        }}
                      >
                        {tfLongLabel(tf)}
                      </button>
                      <button
                        type="button"
                        className={styles.star}
                        aria-pressed={p.favorites.includes(tf)}
                        aria-label={`${p.favorites.includes(tf) ? "Remove" : "Add"} ${tfLongLabel(tf)} ${p.favorites.includes(tf) ? "from" : "to"} favourites`}
                        onClick={() => p.onToggleFavorite(tf)}
                      >
                        <Icon name="star" size={14} filled={p.favorites.includes(tf)} />
                      </button>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <span className={styles.sep} aria-hidden="true" />

      <div className={styles.dd} ref={typeRef}>
        <button
          type="button"
          className={styles.tbBtn}
          aria-expanded={typeOpen}
          aria-label={`Chart type: ${CHART_TYPES.find((t) => t.id === p.chartType)?.label}`}
          onClick={() => setTypeOpen((o) => !o)}
        >
          <Icon name={p.chartType} />
        </button>
        {typeOpen && (
          <div className={styles.menu} role="menu">
            {CHART_TYPES.map((t) => (
              <button
                key={t.id}
                type="button"
                role="menuitemradio"
                aria-checked={t.id === p.chartType}
                className={styles.menuItem}
                onClick={() => {
                  p.onChartType(t.id);
                  setTypeOpen(false);
                }}
              >
                <Icon name={t.id} /> {t.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <button type="button" className={styles.tbBtn} onClick={p.onIndicators}>
        <Icon name="fx" /> Indicators
      </button>
      <span className={styles.sep} aria-hidden="true" />

      <div className={styles.dd} ref={layerRef}>
        <button
          type="button"
          className={styles.tbBtn}
          aria-expanded={layerOpen}
          onClick={() => setLayerOpen((o) => !o)}
        >
          Overlays <Icon name="chevron" size={14} />
        </button>
        {layerOpen && (
          <div className={styles.menu} role="menu">
            {LAYERS.map(([k, label]) => (
              <button
                key={k}
                type="button"
                role="menuitemcheckbox"
                aria-checked={p.layers[k]}
                className={styles.menuItem}
                onClick={() => p.onLayer(k)}
              >
                <span className={styles.check} aria-hidden="true">
                  {p.layers[k] ? "✓" : ""}
                </span>
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      <span className={styles.grow} />
      <div className={styles.tfGroup} role="group" aria-label="Price scale">
        <button
          type="button"
          className={styles.tbBtn}
          aria-pressed={p.scale === "percent"}
          title="Percent scale"
          onClick={() => p.onScale(p.scale === "percent" ? "normal" : "percent")}
        >
          %
        </button>
        <button
          type="button"
          className={styles.tbBtn}
          aria-pressed={p.scale === "log"}
          title="Logarithmic scale"
          onClick={() => p.onScale(p.scale === "log" ? "normal" : "log")}
        >
          log
        </button>
      </div>
      <button
        type="button"
        className={styles.tbBtn}
        aria-label="Take a snapshot"
        onClick={p.onScreenshot}
      >
        <Icon name="camera" />
      </button>
      <button
        type="button"
        className={styles.tbBtn}
        aria-label="Fullscreen"
        onClick={p.onFullscreen}
      >
        <Icon name="fullscreen" />
      </button>
    </div>
  );
};

export default ChartToolbar;
