import { Modal } from "./Modal";
import {
  DEFAULT_OVERLAYS,
  PATTERN_TAG_CHOICES,
  PER_KIND_CHOICES,
  ZONE_ATR_CHOICES,
  type OverlaySettings,
} from "../../utils/overlaySettings";
import styles from "./ChartPage.module.scss";

type Flag = {
  [K in keyof OverlaySettings]: OverlaySettings[K] extends boolean ? K : never;
}[keyof OverlaySettings];

const SHOW: [Flag, string][] = [
  ["pattern", "Patterns"],
  ["zones", "Demand / supply zones"],
  ["orderBlocks", "Order blocks"],
  ["fvg", "Fair value gaps"],
  ["vp", "Volume profile"],
  ["heatmap", "Liquidity heatmap"],
  ["labels", "Labels on zones and blocks"],
];

const FILTERS: [Flag, string, string][] = [
  ["mergeOverlaps", "Merge overlapping levels", "Draw only the stronger of two overlapping levels"],
  ["freshOnly", "Fresh levels only", "Untested zones and unmitigated order blocks"],
  ["showBroken", "Show recently broken levels", "Faint, for context"],
];

/** What the chart draws: which layers, and which levels count as "key". Saved in this browser. */
const OverlaySettingsDialog: React.FC<{
  value: OverlaySettings;
  onChange: (next: OverlaySettings) => void;
  onClose: () => void;
}> = ({ value, onChange, onClose }) => {
  const set = <K extends keyof OverlaySettings>(k: K, v: OverlaySettings[K]) =>
    onChange({ ...value, [k]: v });
  const select = <K extends "perKind" | "minZoneAtr" | "patternTags">(
    k: K,
    label: string,
    choices: readonly number[],
    format: (n: number) => string,
  ) => (
    <label>
      <span>{label}</span>
      <select
        className={styles.select}
        value={value[k]}
        onChange={(e) => set(k, Number(e.target.value) as OverlaySettings[K])}
      >
        {choices.map((c) => (
          <option key={c} value={c}>
            {format(c)}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <Modal
      title="Chart display"
      onClose={onClose}
      footer={
        <>
          <button type="button" className={styles.btn} onClick={() => onChange(DEFAULT_OVERLAYS)}>
            Reset to defaults
          </button>
          <span className={styles.grow} />
          <button type="button" className={styles.btnPrimary} onClick={onClose}>
            Done
          </button>
        </>
      }
    >
      <p className={styles.mute}>
        Only changes what is drawn. Setups are still located against every zone and order block, and
        the statistics don't change.
      </p>
      <h3 className={styles.sub}>Show</h3>
      <div className={styles.form}>
        {SHOW.map(([k, label]) => (
          <label key={k}>
            <span>{label}</span>
            <input type="checkbox" checked={value[k]} onChange={(e) => set(k, e.target.checked)} />
          </label>
        ))}
      </div>
      <h3 className={styles.sub}>Key levels</h3>
      <div className={styles.form}>
        {select("perKind", "Nearest levels of each kind", PER_KIND_CHOICES, (n) => String(n))}
        {select("minZoneAtr", "Zones: minimum departure", ZONE_ATR_CHOICES, (n) => `${n} ATR`)}
        {FILTERS.map(([k, label, hint]) => (
          <label key={k} title={hint}>
            <span>
              {label} <span className={styles.mute}>· {hint}</span>
            </span>
            <input type="checkbox" checked={value[k]} onChange={(e) => set(k, e.target.checked)} />
          </label>
        ))}
      </div>
      <h3 className={styles.sub}>Pattern tags</h3>
      <div className={styles.form}>
        {select("patternTags", "Other recent patterns tagged", PATTERN_TAG_CHOICES, (n) =>
          n === 0 ? "None (selected only)" : String(n),
        )}
      </div>
    </Modal>
  );
};

export default OverlaySettingsDialog;
