import styles from "./AboutUs.module.scss";

const AboutUs: React.FC = () => {
  return (
    <div className={styles.aboutUs}>
      <h2>About Us</h2>
      <p>
        Welcome to our Multi Exchange Dashboard application. We are dedicated to
        providing real-time market data and insights across various
        cryptocurrency exchanges.
      </p>
    </div>
  );
};

export default AboutUs;
