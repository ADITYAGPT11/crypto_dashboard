import { NavLink } from "react-router-dom";
import RealTimeClock from "../../common-components/RealTimeClock";
import { useConnectionSummary } from "../../custom-hooks/useConnectionSummary";
import { BRAND } from "../../brand";
import styles from "./TopNav.module.scss";

const LINKS = [
  { to: "/", label: "Dashboard", end: true },
  { to: "/chart", label: "Chart", end: false },
  { to: "/stats", label: "Pattern stats", end: false },
  { to: "/risk", label: "Risk", end: false },
  { to: "/alerts", label: "Alerts", end: false },
  { to: "/markets", label: "Markets", end: false },
  { to: "/about", label: "About", end: false },
];

const TopNav: React.FC = () => {
  const states = Object.values(useConnectionSummary());
  const live = states.filter((s) => s === "live").length;
  return (
    <header className={styles.top}>
      <div className={styles.left}>
        <NavLink to="/" className={styles.brand} aria-label={`${BRAND.name} home`}>
          <img src={BRAND.logo} width="28" height="28" alt="" />
          <b>
            <span className={styles.lead}>{BRAND.lead}</span>
            {BRAND.rest}
          </b>
        </NavLink>
        <nav className={styles.nav} aria-label="Main">
          {LINKS.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end}
              className={({ isActive }) => (isActive ? styles.active : undefined)}
            >
              {l.label}
            </NavLink>
          ))}
        </nav>
      </div>
      <div className={styles.right}>
        {states.length > 0 && (
          <span className={live > 0 ? styles.ok : styles.warn}>
            <i aria-hidden="true" />
            {live > 0 ? `Live · ${live} exchange${live === 1 ? "" : "s"}` : "Connecting…"}
          </span>
        )}
        <span className={styles.rule}>Human executes · no auto-trading</span>
        <span className={styles.clock}>
          <RealTimeClock />
        </span>
      </div>
    </header>
  );
};

export default TopNav;
