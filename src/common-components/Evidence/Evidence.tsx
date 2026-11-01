import { useId, useState, type ReactNode } from "react";
import type { SetupStats, Verdict } from "../../types/analysis";
import { pct } from "../../utils/format";
import styles from "./Evidence.module.scss";

type Tone = "up" | "down" | "warn" | "info" | "lock";

export function Chip({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`${styles.chip} ${styles[tone]}`}>{children}</span>;
}

const VERDICT: Record<Verdict, { tone: Tone; label: string }> = {
  edge: { tone: "up", label: "Edge candidate" },
  noEdge: { tone: "down", label: "No edge" },
  tooFew: { tone: "warn", label: "Too few cases" },
};

export function VerdictChip({ verdict }: { verdict: Verdict }) {
  const v = VERDICT[verdict];
  return <Chip tone={v.tone}>{v.label}</Chip>;
}

/**
 * Win rate with its 95% range, plus a tick at the break-even win rate.
 * The range sitting fully right of the tick is what "edge candidate" means.
 */
export function CiBar({
  stats,
}: {
  stats: Pick<SetupStats, "winRate" | "ci" | "breakEven" | "n">;
}) {
  const [lo, hi] = stats.ci;
  const label = `Win rate ${pct(stats.winRate)} from ${stats.n} cases, 95% range ${pct(lo)} to ${pct(hi)}, break-even ${pct(stats.breakEven)}`;
  return (
    <div className={styles.ci} role="img" aria-label={label}>
      <span className={styles.be} style={{ left: `${stats.breakEven * 100}%` }} />
      <span
        className={styles.band}
        style={{ left: `${lo * 100}%`, width: `${(hi - lo) * 100}%` }}
      />
      <span className={styles.pt} style={{ left: `calc(${stats.winRate * 100}% - 1px)` }} />
    </div>
  );
}

/** A "?" button that reveals a short explanation in place (works on touch). */
export function Explain({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span className={styles.explain}>
      <button
        type="button"
        className={styles.q}
        aria-expanded={open}
        aria-controls={id}
        aria-label={`Explain: ${title}`}
        onClick={() => setOpen((o) => !o)}
      >
        ?
      </button>
      {open && (
        <span id={id} role="note" className={styles.pop}>
          <b>{title}</b>
          {children}
        </span>
      )}
    </span>
  );
}
