import { useId, useState, type ReactNode } from "react";
import styles from "./Evidence.module.scss";

type Tone = "up" | "down" | "warn" | "info" | "lock";

export function Chip({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`${styles.chip} ${styles[tone]}`}>{children}</span>;
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
