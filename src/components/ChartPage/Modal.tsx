import { useEffect, useId, useRef, type ReactNode } from "react";
import { Icon } from "./icons";
import styles from "./ChartPage.module.scss";

/** Accessible modal: focus moves in, Escape or a backdrop click closes it. */
export function Modal({
  title,
  onClose,
  children,
  footer,
  width = 520,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    box.current?.querySelector<HTMLElement>("input, button, select")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      prev?.focus();
    };
  }, [onClose]);
  return (
    <div className={styles.backdrop} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        className={styles.modal}
        style={{ maxWidth: width }}
      >
        <div className={styles.modalHead}>
          <h2 id={id}>{title}</h2>
          <button type="button" className={styles.tbBtn} aria-label="Close" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        <div className={styles.modalBody}>{children}</div>
        {footer && <div className={styles.modalFoot}>{footer}</div>}
      </div>
    </div>
  );
}
