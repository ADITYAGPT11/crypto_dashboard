import styles from "./MarketOverview.module.scss";

/** Correlation matrix of 4h returns; darker blue = moves more together. */
const Correlation: React.FC<{ symbols: string[]; values: number[][] }> = ({ symbols, values }) => {
  const bases = symbols.map((s) => s.split("-")[0]);
  const finite = values.flatMap((row, i) => row.filter((v, j) => i !== j && Number.isFinite(v)));
  const avg = finite.length ? finite.reduce((s, v) => s + v, 0) / finite.length : Number.NaN;
  return (
    <section
      className={`${styles.card} ${styles.wide}`}
      aria-labelledby="corr-title"
      style={{ flexBasis: 520 }}
    >
      <div className={styles.cardHead}>
        <h2 id="corr-title">Correlation · 30 days</h2>
        <p>
          1.00 = always move together · lower = spreads risk
          {Number.isFinite(avg) ? ` · average pair ${avg.toFixed(2)}` : ""}
        </p>
      </div>
      {symbols.length < 2 ? (
        <p className={styles.mute}>Needs history for at least two coins.</p>
      ) : (
        <div className={styles.xs}>
          <table className="sr-only">
            <caption>Correlation of 4h returns over 30 days</caption>
            <tbody>
              {values.map((row, i) => (
                <tr key={symbols[i]}>
                  <th scope="row">{bases[i]}</th>
                  {row.map((v, j) => (
                    <td key={symbols[j]}>
                      {bases[j]} {Number.isFinite(v) ? v.toFixed(2) : "n/a"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <div
            className={styles.matrix}
            aria-hidden="true"
            style={{ gridTemplateColumns: `52px repeat(${symbols.length}, minmax(38px, 1fr))` }}
          >
            <span />
            {bases.map((b) => (
              <span key={`h${b}`} className={styles.axis}>
                {b}
              </span>
            ))}
            {values.map((row, i) => [
              <span key={`r${bases[i]}`} className={styles.axis} style={{ textAlign: "left" }}>
                {bases[i]}
              </span>,
              ...row.map((v, j) => {
                const a = Number.isFinite(v) ? 0.06 + 0.74 * Math.max(0, (v - 0.3) / 0.7) : 0;
                return (
                  <span
                    key={`${bases[i]}${bases[j]}`}
                    style={{
                      background: `rgba(76, 154, 255, ${a.toFixed(2)})`,
                      color: a > 0.5 ? "#fff" : "#c9d7e6",
                    }}
                  >
                    {Number.isFinite(v) ? v.toFixed(2) : "—"}
                  </span>
                );
              }),
            ])}
          </div>
        </div>
      )}
    </section>
  );
};

export default Correlation;
