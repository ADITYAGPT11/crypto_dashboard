import { useState } from "react";
import { INDICATORS, type IndicatorId } from "../../utils/indicatorRegistry";
import { Modal } from "./Modal";
import styles from "./ChartPage.module.scss";

const CATEGORIES = ["Trend", "Momentum", "Volatility", "Volume"] as const;

/** TradingView-style "Indicators" picker: search, categories, click to add (stays open). */
const IndicatorsDialog: React.FC<{
  onAdd: (id: IndicatorId) => void;
  onClose: () => void;
  counts: Record<string, number>;
}> = ({ onAdd, onClose, counts }) => {
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  const match = INDICATORS.filter(
    (d) => !query || d.name.toLowerCase().includes(query) || d.short.toLowerCase().includes(query),
  );
  return (
    <Modal title="Indicators" onClose={onClose} width={560}>
      <label className="sr-only" htmlFor="ind-search">
        Search indicators
      </label>
      <input
        id="ind-search"
        className={styles.search}
        type="search"
        placeholder="Search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <div className={styles.indList}>
        {CATEGORIES.map((cat) => {
          const items = match.filter((d) => d.category === cat);
          if (items.length === 0) return null;
          return (
            <div key={cat}>
              <div className={styles.menuHead}>{cat}</div>
              {items.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  className={styles.indItem}
                  onClick={() => onAdd(d.id)}
                >
                  <span>{d.name}</span>
                  <span className={styles.mute}>
                    {d.placement === "pane"
                      ? "own pane"
                      : d.placement === "volume"
                        ? "volume"
                        : "on price"}
                    {counts[d.id] ? ` · added ${counts[d.id]}` : ""}
                  </span>
                </button>
              ))}
            </div>
          );
        })}
        {match.length === 0 && <p className={styles.mute}>No indicator matches “{q}”.</p>}
      </div>
      <p className={styles.faint}>Calculated with indicatorts (MIT). Values use closed candles.</p>
    </Modal>
  );
};

export default IndicatorsDialog;
