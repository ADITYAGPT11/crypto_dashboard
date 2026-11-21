import type { CatalogOut, RunOut } from "../../api/schema";
import { useStats } from "../../custom-hooks/useAnalysisApi";
import type { CandleInterval } from "../../types/marketData";
import {
  DETECTION_TFS,
  shownPatterns,
  toggleTf,
  type DetectionConfig,
} from "../../utils/detectionConfig";
import { shortDate } from "../../utils/format";
import styles from "./ChartPage.module.scss";

const TF_NAME: Record<string, string> = { "1h": "1 hour", "4h": "4 hours", "1d": "1 day" };

/** Families shown in the list: each pattern with its bearish twin as one line. */
const FAMILIES: { label: string; ids: string[] }[] = [
  { label: "Double bottom / top", ids: ["doubleBottom", "doubleTop"] },
  { label: "Head and shoulders", ids: ["inverseHeadShoulders", "headShoulders"] },
  { label: "Bull / bear flag", ids: ["bullFlag", "bearFlag"] },
  {
    label: "Triangles",
    ids: ["ascendingTriangle", "descendingTriangle", "symmetricalTriangle"],
  },
  { label: "Wedges", ids: ["fallingWedge", "risingWedge"] },
];

function runText(run: RunOut | null | undefined, error: string | null): string {
  if (error) return "service offline";
  if (!run) return "not measured yet";
  if (run.status === "running") return `measuring ${run.done}/${run.coins.length} coins…`;
  if (run.status === "failed") return "failed · retrying";
  return `ready · ${run.coins.length - run.failed.length} coins · ${shortDate(run.finishedAt ?? run.startedAt)}`;
}

/** Status of the background statistics for the first picked timeframe. */
function WinRateStatus({ tf }: { tf: CandleInterval }) {
  const s = useStats(tf, tf);
  const text = runText(s.data?.run, s.error);
  return (
    <p className={styles.patStatus}>
      <span className={styles.mute}>Win rates</span>
      <span className={`${styles.num} ${text.startsWith("ready") ? styles.up : ""}`}>{text}</span>
    </p>
  );
}

/** One setting: the timeframes chart patterns are looked for on. */
const DetectionSettings: React.FC<{
  config: DetectionConfig;
  onChange: (cfg: DetectionConfig) => void;
  catalog: CatalogOut | null;
}> = ({ config, onChange, catalog }) => {
  const ids = new Set(shownPatterns(catalog).map((p) => p.id));
  const families = FAMILIES.filter((f) => f.ids.some((id) => ids.has(id)));
  return (
    <section className={`${styles.card} ${styles.feature}`} aria-labelledby="det-title">
      <div className={styles.cardHead}>
        <h2 id="det-title">Patterns</h2>
        <p>
          Chart patterns found by the analysis service
          {catalog ? ` (rules ${catalog.ruleset})` : ""}. Pick the candles they are looked for on.
        </p>
      </div>
      <fieldset className={styles.tfPick}>
        <legend className={styles.sub}>Timeframes</legend>
        <div>
          {DETECTION_TFS.map((tf) => (
            <button
              key={tf}
              type="button"
              aria-pressed={config.tfs.includes(tf)}
              onClick={() => onChange(toggleTf(config, tf))}
            >
              <b>{tf}</b>
              <span>{TF_NAME[tf]}</span>
            </button>
          ))}
        </div>
        <p className={styles.mute}>
          {config.tfs.length
            ? `Showing patterns from ${config.tfs.join(", ")} on any chart view.`
            : "No timeframe picked: no patterns are shown."}
        </p>
      </fieldset>
      <h3 className={styles.sub}>Looked for</h3>
      {catalog ? (
        <ul className={styles.patNames}>
          {families.map((f) => (
            <li key={f.label}>{f.label}</li>
          ))}
        </ul>
      ) : (
        <p className={styles.mute}>Loading the pattern list…</p>
      )}
      {config.tfs.length > 0 && <WinRateStatus tf={config.tfs[0]} />}
    </section>
  );
};

export default DetectionSettings;
