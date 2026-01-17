import styles from "./Header.module.scss";
import ThemeToggle from "../ThemeToggle";
import RealTimeClock from "../../common-components/RealTimeClock";
import { NavList } from "./NavList";

const Header: React.FC = () => {
  return (
    <div className={styles.header}>
      <div className={styles.headerContent}>
        <h1 className={styles.title}>Multi Exchange Dashboard</h1>

        <div className={styles.rightSection}>
          <NavList />
          <RealTimeClock />
          <ThemeToggle />
        </div>
      </div>
    </div>
  );
};

export default Header;
