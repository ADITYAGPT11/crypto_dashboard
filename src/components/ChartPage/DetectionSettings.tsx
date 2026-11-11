import { useEffect, useId, useRef, useState } from "react";
import type { CatalogOut, RunOut } from "../../api/schema";
import type { CandleInterval } from "../../types/marketData";
import {
  DETECTION_TFS,
  ZONE_OPTIONS,
  tfsFor,
  zoneTfFor,
  type DetectionConfig,
  type ZoneSourceOption,
} from "../../utils/detectionConfig";
import { useStats } from "../../custom-hooks/useAnalysisApi";
import { shortDate } from "../../utils/format";
import { TfBadge } from "./TfBadge";
import styles from "./ChartPage.module.scss";

const ZONE_LABEL: Record<ZoneSourceOption, string> = {
  same: "Same as the pattern",
  "4h": "4h (or the pattern's, if higher)",
  "1d": "1d (or the pattern's, if higher)",
};

/** A dropdown of timeframe checkboxes for one pattern. */
function TfDropdown({
  label,
  value,
  onChange,
}: {
  label: string;
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
        aria-label={`${label}: detect on ${value.join(", ") || "off"}`}
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
          <legend className="sr-only">Detect {label} on</legend>
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

function runLabel(run: RunOut | null | undefined, error: string | null): string {
  if (error) return "service offline";
  if (!run) return "not measured yet";
  if (run.status === "running") return `${run.done}/${run.coins.length} coins…`;
  if (run.status === "failed") return "failed · retrying";
  return `ready · ${run.coins.length - run.failed.length} coins · ${shortDate(run.finishedAt ?? run.startedAt)}`;
}

function RunRow({ tf, zones }: { tf: CandleInterval; zones: ZoneSourceOption }) {
  const zoneTf = zoneTfFor(tf, zones);
  const s = useStats(tf, zoneTf);
  return (
    <li>
      <span>
        {tf} patterns · {zoneTf} levels
      </span>
      <span className={styles.num}>{runLabel(s.data?.run, s.error)}</span>
    </li>
  );
}

/** Detection timeframes per pattern, level source, and background measuring progress. */
const DetectionSettings: React.FC<{
  config: DetectionConfig;
  onChange: (cfg: DetectionConfig) => void;
  catalog: CatalogOut | null;
}> = ({ config, onChange, catalog }) => {
  const zoneId = useId();
  const groups = [
    { kind: "chart" as const, title: "Chart patterns" },
    { kind: "candlestick" as const, title: "Candlestick patterns" },
  ];
  return (
    <section className={`${styles.card} ${styles.feature}`} aria-labelledby="det-title">
      <div className={styles.cardHead}>
        <h2 id="det-title">Detection settings</h2>
        <p>
          Rules <b>{catalog?.ruleset ?? "…"}</b>, run by the analysis service. Choose where each
          pattern is looked for; the view timeframe above only changes the candles you see.
        </p>
      </div>
      {!catalog && <p className={styles.mute}>Loading the pattern catalogue…</p>}
      {groups.map((g) => {
        const list = (catalog?.patterns ?? []).filter((p) => p.kind === g.kind);
        const on = list.filter((p) => tfsFor(config, p).length > 0).length;
        return (
          <details key={g.kind} className={styles.group}>
            <summary className={styles.sub}>
              {g.title}{" "}
              <span className={styles.mute}>
                {on} of {list.length} on
              </span>
            </summary>
            <div className={styles.setRows}>
              {list.map((p) => (
                <div key={p.id} className={styles.setRow}>
                  <span title={`${p.summary} Source: ${p.source}.`}>
                    {p.label}{" "}
                    <span className={styles.mute}>
                      {p.bias === "long" ? "▲" : p.bias === "short" ? "▼" : "▲▼"}
                    </span>
                  </span>
                  <TfDropdown
                    label={p.label}
                    value={tfsFor(config, p)}
                    onChange={(next) =>
                      onChange({ ...config, patterns: { ...config.patterns, [p.id]: next } })
                    }
                  />
                </div>
              ))}
            </div>
          </details>
        );
      })}
      <h3 className={styles.sub}>Location</h3>
      <div className={styles.setRow}>
        <label htmlFor={zoneId}>Zones and order blocks from</label>
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
        {DETECTION_TFS.map((tf) => (
          <RunRow key={tf} tf={tf} zones={config.zones} />
        ))}
      </ul>
      <p className={styles.note}>
        Each timeframe and level source is its own setup with its own statistics, so these choices
        never tune a rule. Rule changes ship as a new rule-set version, measured from scratch.
      </p>
    </section>
  );
};

export default DetectionSettings;
