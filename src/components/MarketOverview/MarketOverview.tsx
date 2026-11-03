import { useMemo } from "react";
import { RESEARCH_UNIVERSE } from "../../services/HistoryService";
import { useMarketOverview } from "../../custom-hooks/useMarketOverview";
import { useNow } from "../../custom-hooks/useNow";
import type { Candle } from "../../types/marketData";
import { buildCoinRows, meanOf } from "../../utils/marketRows";
import { correlationMatrix, topMovers, volRegime } from "../../utils/marketStats";
import { price } from "../../utils/format";
import BubbleMap from "./BubbleMap";
import CoinSearch from "./CoinSearch";
import Connections from "./Connections";
import Correlation from "./Correlation";
import DataHealth from "./DataHealth";
import Liquidations from "./Liquidations";
import MarketMonitor from "./MarketMonitor";
import { Gainers, Losers } from "./Movers";
import Regime from "./Regime";
import Sentiment from "./Sentiment";
import { signed, tone, usdCompact } from "./format";
import styles from "./MarketOverview.module.scss";

const H4 = 14_400_000;
const CORR_BARS = 180; // 30 days of 4h candles

/**
 * Dashboard market overview for the research universe (10 coins): ticker strip,
 * search + connections, bubbles, sentiment, market monitor, correlation,
 * liquidations, volatility regime, movers and data health.
 */
const MarketOverview: React.FC<{ candles: ReadonlyMap<string, Candle[]> }> = ({ candles }) => {
  const overview = useMarketOverview();
  const now = useNow(1_000);
  const symbols = RESEARCH_UNIVERSE;

  const series = useMemo(() => {
    const m = new Map<string, Candle[]>();
    for (const s of symbols) {
      const c = candles.get(s);
      if (c && c.length > 0) m.set(s, c);
    }
    return m;
  }, [candles, symbols]);

  const matrix = useMemo(() => correlationMatrix(series, CORR_BARS), [series]);
  const corrBtc = useMemo(() => {
    const i = matrix.symbols.indexOf("BTC-USDT");
    return new Map(i < 0 ? [] : matrix.symbols.map((s, j) => [s, matrix.values[i][j]] as const));
  }, [matrix]);

  const rows = useMemo(
    () =>
      buildCoinRows({
        symbols,
        candles: series,
        tickers: overview.tickers.value,
        funding: overview.funding.value,
        openInterest: overview.openInterest.value,
        corrBtc,
      }),
    [
      symbols,
      series,
      overview.tickers.value,
      overview.funding.value,
      overview.openInterest.value,
      corrBtc,
    ],
  );

  const btcCandles = series.get("BTC-USDT");
  const regime = useMemo(() => (btcCandles ? volRegime(btcCandles, H4) : null), [btcCandles]);
  const movers = topMovers(
    rows.map((r) => ({ ...r, change: r.change24h })),
    3,
  );

  const btc = rows.find((r) => r.symbol === "BTC-USDT");
  const eth = rows.find((r) => r.symbol === "ETH-USDT");
  const volume = rows.reduce((s, r) => s + (Number.isFinite(r.quoteVolume) ? r.quoteVolume : 0), 0);
  const funding = meanOf(rows.map((r) => r.fundingPct));
  const oi = meanOf(rows.map((r) => r.oiChange24h));
  const fg = overview.fearGreed.value;
  const any = series.values().next().value as Candle[] | undefined;
  const days =
    any && any.length > 1
      ? Math.round((any[any.length - 1].openTime - any[0].openTime) / 86_400_000)
      : 0;
  const lastCandle = any?.length ? any[any.length - 1].openTime + H4 : null;

  const strip: { k: string; v: string; cls?: string }[] = [
    {
      k: "BTC",
      v: btc ? `${price(btc.price)} ${signed(btc.change24h)}` : "—",
      cls: styles[tone(btc?.change24h)],
    },
    {
      k: "ETH",
      v: eth ? `${price(eth.price)} ${signed(eth.change24h)}` : "—",
      cls: styles[tone(eth?.change24h)],
    },
    { k: "ETH / BTC", v: btc && eth ? (eth.price / btc.price).toFixed(5) : "—" },
    { k: `${rows.length}-coin volume 24h`, v: volume > 0 ? usdCompact(volume) : "—" },
    { k: "Avg funding / 8h", v: signed(funding, 4) },
    { k: "Open interest 24h", v: signed(oi), cls: styles[tone(oi)] },
    { k: "Fear & Greed", v: fg ? `${fg.value} ${fg.label}` : "—" },
    {
      k: "BTC volatility 7d",
      v: regime ? `${regime.current.toFixed(0)}% · ${regime.regime}` : "—",
    },
  ];

  return (
    <>
      <div className={styles.strip} role="region" aria-label="Market summary">
        {strip.map((t) => (
          <div key={t.k}>
            <span>{t.k}</span>
            <span className={t.cls}>{t.v}</span>
          </div>
        ))}
      </div>

      <div className={styles.searchRow}>
        <CoinSearch fallback={symbols} />
        <Connections />
      </div>

      {overview.tickers.state === "unavailable" && rows.length === 0 && (
        <p className={styles.note} role="alert">
          Binance futures prices are unreachable from this browser; panels fill in once they load.
        </p>
      )}

      <div className={styles.row}>
        <BubbleMap rows={rows} />
        <Sentiment overview={overview} rows={rows} />
      </div>

      <MarketMonitor rows={rows} />

      <div className={styles.row}>
        <Correlation symbols={matrix.symbols} values={matrix.values} />
        <Liquidations liq={overview.liquidations} now={now} />
        <Regime regime={regime} now={now} />
      </div>

      <div className={styles.grid3}>
        <Gainers rows={movers.gainers} />
        <Losers rows={movers.losers} />
        <DataHealth
          now={now}
          coins={series.size}
          universe={symbols.length}
          days={days}
          lastCandle={lastCandle}
          overviewUpdatedAt={overview.tickers.updatedAt}
        />
      </div>
    </>
  );
};

export default MarketOverview;
