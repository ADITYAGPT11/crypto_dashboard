import type { PlaybookStatsOut, RSummaryOut } from "../../api/schema";
import { Explain, VerdictChip } from "../../common-components/Evidence";
import { pct, shortDate } from "../../utils/format";
import {
  ENTRY_LABEL,
  EXIT_LABEL,
  signedR,
  variantKey,
  type VariantKey,
} from "../../utils/playbook";
import styles from "./Playbook.module.scss";

function RCell({ s }: { s: RSummaryOut | null }) {
  if (!s || s.n === 0) return <td className={`${styles.r} ${styles.mute}`}>—</td>;
  return (
    <td className={styles.r}>
      <span className={s.meanR >= 0.005 ? styles.up : s.meanR <= -0.005 ? styles.down : undefined}>
        {signedR(s.meanR)}
      </span>
      <small className={styles.sub}>
        {signedR(s.meanRLow)} to {signedR(s.meanRHigh)} · n {s.n}
      </small>
    </td>
  );
}

/** Every entry × exit variant of the playbook with its measured record. */
export function PlaybookTable({
  stats,
  selected,
  onSelect,
}: {
  stats: PlaybookStatsOut;
  selected?: VariantKey;
  onSelect?: (key: VariantKey) => void;
}) {
  const split = stats.split;
  return (
    <div className={styles.scroll}>
      <table className={styles.tbl}>
        <caption className="sr-only">Playbook variants and their measured records</caption>
        <thead>
          <tr>
            <th>Entry · exit</th>
            <th className={styles.r}>
              Mean R, net{" "}
              <Explain title="Mean R after costs">
                Average result per trade in R (1R = the distance from entry to stop), after Binance
                fees (maker 0.02%, taker 0.05%) and 0.02% slippage on taker fills, with its 95%
                range. Above zero means the variant made money on these coins and years.
              </Explain>
            </th>
            <th className={styles.r}>Win rate</th>
            <th className={styles.r}>
              vs random{" "}
              <Explain title="Compared with random entries">
                Each trade replayed from a random 15m candle in the same 4h trigger window, with the
                same stop distance and exit rule. The difference (and its 95% range) is what the
                playbook's timing adds; around zero means the entry rules add nothing.
              </Explain>
            </th>
            <th className={styles.r}>Older{split ? ` (to ${shortDate(split)})` : ""}</th>
            <th className={styles.r}>
              Newer{" "}
              <Explain title="Older vs newer data">
                The same record split in time: the first 70% of the period and the latest 30%. The
                rules were fixed before this data was measured, so a record that holds on the newer
                part is more believable than one that only shows up in the older part.
              </Explain>
            </th>
            <th>Verdict</th>
          </tr>
        </thead>
        <tbody>
          {stats.variants.map((v) => {
            const key = variantKey(v.entry, v.exit);
            const s = v.all;
            return (
              <tr
                key={key}
                className={key === selected ? styles.rowNow : undefined}
                onClick={onSelect ? () => onSelect(key) : undefined}
              >
                <td>
                  {ENTRY_LABEL[v.entry]}
                  <small className={styles.sub}>{EXIT_LABEL[v.exit]}</small>
                </td>
                <RCell s={s} />
                <td className={styles.r}>
                  {s && s.n ? pct(s.winRate) : "—"}
                  {s && s.n ? (
                    <small className={styles.sub}>
                      {pct(s.ciLow)}–{pct(s.ciHigh)}
                    </small>
                  ) : null}
                </td>
                <td className={styles.r}>
                  {s && s.baselineN ? (
                    <>
                      <span
                        className={
                          s.edgeVsRandomLow > 0
                            ? styles.up
                            : s.edgeVsRandomHigh < 0
                              ? styles.down
                              : undefined
                        }
                      >
                        {signedR(s.edgeVsRandom)}
                      </span>
                      <small className={styles.sub}>
                        {signedR(s.edgeVsRandomLow)} to {signedR(s.edgeVsRandomHigh)}
                      </small>
                    </>
                  ) : (
                    "—"
                  )}
                </td>
                <RCell s={v.inSample} />
                <RCell s={v.outOfSample} />
                <td>{s ? <VerdictChip verdict={s.verdict} /> : null}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
