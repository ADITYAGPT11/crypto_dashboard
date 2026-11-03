import type { DrawingKind } from "lightweight-charts-drawing";
import { Icon } from "./icons";
import styles from "./ChartPage.module.scss";

const TOOLS: { kind: DrawingKind | null; label: string; icon: string }[] = [
  { kind: null, label: "Cursor", icon: "cursor" },
  { kind: "trend-line", label: "Trend line", icon: "trend-line" },
  { kind: "ray", label: "Ray", icon: "ray" },
  { kind: "horizontal-line", label: "Horizontal line", icon: "horizontal-line" },
  { kind: "vertical-line", label: "Vertical line", icon: "vertical-line" },
  { kind: "parallel-channel", label: "Parallel channel", icon: "parallel-channel" },
  { kind: "rectangle", label: "Rectangle", icon: "rectangle" },
  { kind: "fib-retracement", label: "Fib retracement", icon: "fib-retracement" },
  { kind: "price-range", label: "Price range", icon: "price-range" },
  { kind: "long-position", label: "Long position", icon: "long-position" },
  { kind: "text", label: "Text", icon: "text" },
  { kind: "brush", label: "Brush", icon: "brush" },
];

/** TradingView-style drawing tools down the left edge of the chart. */
const DrawingToolbar: React.FC<{
  tool: DrawingKind | null;
  onTool: (k: DrawingKind | null) => void;
  magnet: boolean;
  onMagnet: () => void;
  visible: boolean;
  onVisible: () => void;
  onClear: () => void;
}> = ({ tool, onTool, magnet, onMagnet, visible, onVisible, onClear }) => (
  <div
    className={styles.drawBar}
    role="toolbar"
    aria-label="Drawing tools"
    aria-orientation="vertical"
  >
    {TOOLS.map((t) => (
      <button
        key={t.label}
        type="button"
        className={styles.drawBtn}
        aria-pressed={tool === t.kind}
        aria-label={t.label}
        title={t.label}
        onClick={() => onTool(tool === t.kind ? null : t.kind)}
      >
        <Icon name={t.icon} />
      </button>
    ))}
    <span className={styles.drawSep} aria-hidden="true" />
    <button
      type="button"
      className={styles.drawBtn}
      aria-pressed={magnet}
      aria-label="Magnet mode"
      title="Magnet: snap to OHLC"
      onClick={onMagnet}
    >
      <Icon name="magnet" />
    </button>
    <button
      type="button"
      className={styles.drawBtn}
      aria-pressed={!visible}
      aria-label={visible ? "Hide all drawings" : "Show all drawings"}
      title={visible ? "Hide all drawings" : "Show all drawings"}
      onClick={onVisible}
    >
      <Icon name={visible ? "eye" : "eye-off"} />
    </button>
    <button
      type="button"
      className={styles.drawBtn}
      aria-label="Remove all drawings"
      title="Remove all drawings"
      onClick={onClear}
    >
      <Icon name="trash" />
    </button>
  </div>
);

export default DrawingToolbar;
