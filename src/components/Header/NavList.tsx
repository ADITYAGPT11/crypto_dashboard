import { Link } from "react-router-dom";
import styles from "./NavList.module.scss"

export const NavList: React.FC = () => {
  return (
    <nav className={styles.navListWarpper}>
      <Link className={styles.link} to="/">Home</Link>
      <Link className={styles.link} to="/about">About</Link>
    </nav>
  );
};