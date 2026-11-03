import { useEffect, useId, useRef, useState } from "react";
import type { CandleInterval } from "../../types/marketData";
import type { PatternType } from "../../types/analysis";
import { PATTERN_LABELS } from "../../utils/patterns";
import {
  DETECTION_TFS,
  PATTERN_TYPES,
  PRESET,
  ZONE_OPTIONS,
  type DetectionConfig,
  type ZoneSourceOption,
} from "../../utils/detectionConfig";
import type { ContextStats } from "../../services/SetupStatsService";
import { TfBadge } from "./TfBadge";
import styles from "./ChartPage.module.scss";

const ZONE_LABEL: Record<ZoneSourceOption, string> = {
  same: "Same as the pattern",
  "4h": "4h (or the pattern's, if higher)",
  "1d": "1d (or the pattern's, if higher)",
};

/** A dropdown of timeframe checkboxes for one pattern. */
function TfDropdown({
  pattern,
  value,
  onChange,
}: {
  pattern: PatternType;
  value: CandleInterval[];
  onChange: (next: CandleInterval[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
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

  return (
    <div className={styles.dd} ref={ref}>
      <button
        type="button"
        className={styles.ddBtn}
        aria-expanded={open}
        aria-controls={id}
        aria-label={`${PATTERN_LABELS[pattern]}: detect on ${value.join(", ") || "off"}`}
        onClick={() => setOpen((o) => !o)}
      >
        <span className={styles.ddVal}>
          {value.length ? (
            value.map((tf) => <TfBadge key={tf} tf={tf} />)
          ) : (
            <span className={styles.mute}>Off</span>
          )}
        </span>
        <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <fieldset id={id} className={styles.ddMenu}>
          <legend className="sr-only">Detect {PATTERN_LABELS[pattern]} on</legend>
          {DETECTION_TFS.map((tf) => (
            <label key={tf}>
              <input
                type="checkbox"
                checked={value.includes(tf)}
                onChange={(e) =>
                  onChange(
                    DETECTION_TFS.filter((x) => (x === tf ? e.target.checked : value.includes(x))),
                  )
                }
              />
              <TfBadge tf={tf} />
              <span>{tf === "1h" ? "1 hour" : tf === "4h" ? "4 hours" : "1 day"}</span>
            </label>
          ))}
        </fieldset>
      )}
    </div>
  );
}

/** Detection timeframes per pattern, zone source, and background measuring progress. */
const DetectionSettings: React.FC<{
  config: DetectionConfig;
  onChange: (cfg: DetectionConfig) => void;
  progress: { label: string; stats: ContextStats | null }[];
}> = ({ config, onChange, progress }) => {
  const zoneId = useId();
  return (
    <section className={`${styles.card} ${styles.feature}`} aria-labelledby="det-title">
      <div className={styles.cardHead}>
        <h2 id="det-title">Detection settings</h2>
        <p>
          Preset{" "}
          <b>
            {PRESET.id} · {PRESET.name}
          </b>{" "}
          (rules frozen {PRESET.frozen}). Choose where each pattern is looked for; the view
          timeframe above only changes the candles you see.
        </p>
      </div>
      <h3 className={styles.sub}>Detect each pattern on</h3>
      <div className={styles.setRows}>
        {PATTERN_TYPES.map((p) => (
          <div key={p} className={styles.setRow}>
            <span>{PATTERN_LABELS[p]}</span>
            <TfDropdown
              pattern={p}
              value={config.patterns[p]}
              onChange={(next) =>
                onChange({ ...config, patterns: { ...config.patterns, [p]: next } })
              }
            />
          </div>
        ))}
      </div>
      <h3 className={styles.sub}>Location</h3>
      <div className={styles.setRow}>
        <label htmlFor={zoneId}>Demand zones from</label>
        <select
          id={zoneId}
          className={styles.select}
          value={config.zones}
          onChange={(e) => onChange({ ...config, zones: e.target.value as ZoneSourceOption })}
        >
          {ZONE_OPTIONS.map((z) => (
            <option key={z} value={z}>
              {ZONE_LABEL[z]}
            </option>
          ))}
        </select>
      </div>
      <h3 className={styles.sub}>Statistics (all coins, measured in the background)</h3>
      <ul className={styles.progress}>
        {progress.map(({ label, stats }) => (
          <li key={label}>
            <span>{label}</span>
            <span className={styles.num}>
              {!stats || stats.state === "queued"
                ? "queued"
                : stats.state === "running"
                  ? `${stats.done}/${stats.total} coins…`
                  : `ready · ${stats.total - stats.failed.length} coins`}
            </span>
          </li>
        ))}
      </ul>
      <p className={styles.note}>
        Each timeframe and zone source is its own setup with its own statistics, so these choices
        never tune a rule. Editable rule versions (v2) come later and will be labelled exploratory.
      </p>
    </section>
  );
};

export default DetectionSettings;
