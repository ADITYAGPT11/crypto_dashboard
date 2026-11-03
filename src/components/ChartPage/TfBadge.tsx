import { TF_COLOR } from "./PriceChart";
import styles from "./ChartPage.module.scss";

/** Coloured timeframe label: 1h purple, 4h blue, 1d amber (matches the chart overlay). */
export function TfBadge({ tf }: { tf: string }) {
  return (
    <span className={styles.tf} style={{ background: TF_COLOR[tf] ?? "var(--t-raised)" }}>
      {tf}
    </span>
  );
}
