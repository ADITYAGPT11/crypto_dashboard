import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { CatalogOut } from "../../api/schema";
import {
  DETECTION_TFS,
  isPicked,
  patternOptions,
  setPicks,
  toggleTf,
  type DetectionConfig,
  type PatternOption,
} from "../../utils/detectionConfig";
import { TfBadge } from "./TfBadge";
import styles from "./ChartPage.module.scss";

const TF_NAME: Record<string, string> = { "1h": "1 hour", "4h": "4 hours", "1d": "1 day" };
const KINDS = [
  { kind: "chart" as const, title: "Chart patterns" },
  { kind: "candlestick" as const, title: "Candlestick patterns" },
];

/** A button that opens a menu below it; closes on an outside click or Escape. */
function Dropdown({
  label,
  summary,
  children,
}: {
  label: string;
  summary: ReactNode;
  children: ReactNode;
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
    <div className={styles.pick} ref={ref}>
      <span className={styles.pickLabel} id={`${id}-label`}>
        {label}
      </span>
      <button
        type="button"
        className={styles.pickBtn}
        aria-expanded={open}
        aria-controls={id}
        aria-labelledby={`${id}-label`}
        onClick={() => setOpen((o) => !o)}
      >
        <span className={styles.pickSummary}>{summary}</span>
        <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div id={id} className={styles.pickMenu} role="group" aria-labelledby={`${id}-label`}>
          {children}
        </div>
      )}
    </div>
  );
}

/** A checkbox row: the real input stays focusable, a drawn box shows its state. */
function Check({
  on,
  onChange,
  children,
}: {
  on: boolean;
  onChange: (on: boolean) => void;
  children: ReactNode;
}) {
  return (
    <label className={`${styles.opt} ${on ? styles.optOn : ""}`}>
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} />
      <span className={styles.optBox} aria-hidden="true">
        <svg width="10" height="8" viewBox="0 0 10 8">
          <path d="M1 4l3 3 5-6" />
        </svg>
      </span>
      {children}
    </label>
  );
}

/** Small trend line: rising for bullish patterns, falling for bearish ones. */
function TrendIcon({ up }: { up: boolean }) {
  return (
    <span className={`${styles.trend} ${up ? styles.up : styles.down}`} aria-hidden="true">
      <svg width="14" height="10" viewBox="0 0 14 10">
        <path d={up ? "M1 9 L5 5 L8 7 L13 1" : "M1 1 L5 5 L8 3 L13 9"} />
      </svg>
    </span>
  );
}

/** The pattern menu's list: sections by kind, then bullish / bearish; scrolls with a fade. */
function PatternList({
  options,
  config,
  onChange,
}: {
  options: PatternOption[];
  config: DetectionConfig;
  onChange: (cfg: DetectionConfig) => void;
}) {
  // The bottom fades only while there is more below.
  const [atEnd, setAtEnd] = useState(true);
  const ref = useRef<HTMLDivElement>(null);
  const measure = () => {
    const el = ref.current;
    if (el) setAtEnd(el.scrollTop + el.clientHeight >= el.scrollHeight - 4);
  };
  useEffect(measure, []);
  return (
    <div
      ref={ref}
      className={`${styles.pickScroll} ${atEnd ? "" : styles.pickFade}`}
      onScroll={measure}
    >
      {KINDS.map(({ kind, title }) => {
        const list = options.filter((o) => o.kind === kind);
        if (list.length === 0) return null;
        const on = list.filter((o) => isPicked(config, o)).length;
        const all = on === list.length;
        return (
          <section key={kind} aria-label={title}>
            <div className={styles.pickSection}>
              <span>
                {title} · {on} of {list.length}
              </span>
              <button
                type="button"
                onClick={() =>
                  onChange(
                    setPicks(
                      config,
                      list.map((o) => o.key),
                      !all,
                    ),
                  )
                }
              >
                {all ? "Clear" : "Select all"}
              </button>
            </div>
            {(["long", "short"] as const).map((dir) => (
              <div key={dir} className={styles.pickSide}>
                <span className={dir === "long" ? styles.up : styles.down}>
                  {dir === "long" ? "Bullish" : "Bearish"}
                </span>
                {list
                  .filter((o) => o.direction === dir)
                  .map((o) => (
                    <Check
                      key={o.key}
                      on={isPicked(config, o)}
                      onChange={(v) => onChange(setPicks(config, [o.key], v))}
                    >
                      <TrendIcon up={dir === "long"} />
                      <span>{o.label}</span>
                    </Check>
                  ))}
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}

/** "2 TF · 14 on": the Patterns button's summary of the settings. */
export function detectionSummary(config: DetectionConfig, catalog: CatalogOut | null): string {
  const on = catalog ? patternOptions(catalog).filter((o) => isPicked(config, o)).length : null;
  return `${config.tfs.length} TF${on === null ? "" : ` · ${on} on`}`;
}

/** Two choices for every screen: which timeframes, and which patterns (per direction). */
const DetectionSettings: React.FC<{
  config: DetectionConfig;
  onChange: (cfg: DetectionConfig) => void;
  catalog: CatalogOut | null;
}> = ({ config, onChange, catalog }) => {
  const options = patternOptions(catalog);
  const count = (kind: PatternOption["kind"]) =>
    options.filter((o) => o.kind === kind && isPicked(config, o)).length;
  return (
    <div className={styles.picks}>
      <h2 className={styles.popTitle}>Pattern settings</h2>
      <Dropdown
        label="Timeframes"
        summary={
          config.tfs.length ? (
            config.tfs.map((tf) => <TfBadge key={tf} tf={tf} />)
          ) : (
            <span className={styles.mute}>None: no patterns shown</span>
          )
        }
      >
        {DETECTION_TFS.map((tf) => (
          <Check
            key={tf}
            on={config.tfs.includes(tf)}
            onChange={() => onChange(toggleTf(config, tf))}
          >
            <b className={styles.num}>{tf}</b>
            <span className={styles.mute}>{TF_NAME[tf]}</span>
          </Check>
        ))}
      </Dropdown>
      <Dropdown
        label="Patterns"
        summary={
          catalog ? (
            `${count("chart")} chart · ${count("candlestick")} candlestick`
          ) : (
            <span className={styles.mute}>Loading…</span>
          )
        }
      >
        <PatternList options={options} config={config} onChange={onChange} />
      </Dropdown>
      <p className={styles.note}>Saved in this browser and used on every page.</p>
    </div>
  );
};

export default DetectionSettings;
