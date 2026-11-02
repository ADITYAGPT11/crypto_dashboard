import { Link } from "react-router-dom";
import { useSetupAlerts } from "../../custom-hooks/useSetupAlerts";
import { SetupAlertService } from "../../services/SetupAlertService";
import { setupName } from "../../utils/setupAlerts";
import { pct } from "../../utils/format";
import styles from "./AlertToast.module.scss";

/** In-app banner for setup alerts that fired and haven't been dismissed. */
const AlertToast: React.FC = () => {
  const unseen = useSetupAlerts().firings.filter((f) => f.unseen);
  if (unseen.length === 0) return null;
  const f = unseen[0];
  const svc = SetupAlertService.getInstance();
  return (
    <aside className={styles.toast} role="status" aria-live="polite">
      <div className={styles.body}>
        <b>
          {f.symbol} printed a {setupName(f.setupKey).toLowerCase()} on {f.interval}
        </b>
        <span>
          Past record: {f.record.wins} of {f.record.n} ({pct(f.record.winRate)}, range{" "}
          {pct(f.record.ci[0])}–{pct(f.record.ci[1])}), before fees.
          {unseen.length > 1 ? ` ${unseen.length - 1} more.` : ""}
        </span>
      </div>
      <Link className={styles.btn} to={`/chart/${f.symbol}`} onClick={() => svc.dismiss(f.id)}>
        Chart
      </Link>
      <button type="button" className={styles.btn} onClick={() => svc.dismiss()}>
        Dismiss{unseen.length > 1 ? " all" : ""}
      </button>
    </aside>
  );
};

export default AlertToast;
