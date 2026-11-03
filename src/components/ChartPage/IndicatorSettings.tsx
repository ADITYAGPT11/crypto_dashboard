import { useState } from "react";
import {
  clampInput,
  INDICATOR_BY_ID,
  newInstance,
  type IndicatorInstance,
} from "../../utils/indicatorRegistry";
import { Modal } from "./Modal";
import styles from "./ChartPage.module.scss";

/** TradingView-style settings: Inputs and Style tabs, Defaults / Cancel / OK. */
const IndicatorSettings: React.FC<{
  inst: IndicatorInstance;
  onSave: (inst: IndicatorInstance) => void;
  onClose: () => void;
}> = ({ inst, onSave, onClose }) => {
  const def = INDICATOR_BY_ID.get(inst.id)!;
  const [tab, setTab] = useState<"inputs" | "style">("inputs");
  const [draft, setDraft] = useState(inst);
  const reset = () => {
    const d = newInstance(inst.id, inst.uid);
    setDraft({ ...d, visible: draft.visible });
  };
  return (
    <Modal
      title={def.name}
      onClose={onClose}
      width={420}
      footer={
        <>
          <button type="button" className={styles.btn} onClick={reset}>
            Defaults
          </button>
          <span className={styles.grow} />
          <button type="button" className={styles.btn} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={styles.btnPrimary}
            onClick={() => {
              onSave({
                ...draft,
                params: Object.fromEntries(
                  def.inputs.map((i) => [i.key, clampInput(i, draft.params[i.key])]),
                ),
              });
              onClose();
            }}
          >
            Ok
          </button>
        </>
      }
    >
      <div className={styles.tabs} role="tablist">
        {(["inputs", "style"] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
          >
            {t === "inputs" ? "Inputs" : "Style"}
          </button>
        ))}
      </div>
      {tab === "inputs" ? (
        <div className={styles.form}>
          {def.inputs.map((i) => (
            <label key={i.key}>
              <span>{i.label}</span>
              <input
                type="number"
                min={i.min}
                max={i.max}
                step={i.step}
                value={draft.params[i.key]}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    params: { ...d.params, [i.key]: Number(e.target.value) },
                  }))
                }
              />
            </label>
          ))}
          {def.inputs.length === 0 && <p className={styles.mute}>No inputs.</p>}
        </div>
      ) : (
        <div className={styles.form}>
          {def.plots.map((p) => (
            <label key={p.key}>
              <span>{p.label}</span>
              <input
                type="color"
                value={draft.colors[p.key] ?? p.color}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, colors: { ...d.colors, [p.key]: e.target.value } }))
                }
              />
            </label>
          ))}
        </div>
      )}
    </Modal>
  );
};

export default IndicatorSettings;
