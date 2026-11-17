# Competitor research: order-flow and order-block tools

_Researched 2026-11-17 from web search results. The vendor sites (deepcharts.com, deepcharts.io,
instagram.com, tradingtoolshub.com) could not be fetched from the dev sandbox, so prices come from
search snippets and **conflict between sources**: check the vendor page before quoting a number._

**What this is for:** decide which paid features to rebuild for free in GreenMTM, how each one is
built, and which ones actually help a trader. Concepts (footprint, CVD, heatmap, order blocks)
are public knowledge; we rebuild the ideas, never a vendor's code, names, branding or artwork
(CLAUDE.md guardrail 5).

## 1. Who sells what

### DeepCharts (Volumetrica Trading, Italy; marketed by ACFV Tech Solutions, Dubai)

> The Instagram handle in the brief is `deepcharts.io`. Search finds almost nothing for that
> domain (3 Trustpilot reviews) and it did not resolve from the sandbox. Everything below is the
> well-known **deepcharts.com** product. If `deepcharts.io` is a separate crypto product, send a
> screenshot of its feature or pricing page and this section gets a second entry.

- **Market:** CME and Eurex **futures only** (NQ, ES, FDAX). No crypto, forex or stocks.
- **Data:** Rithmic, CQG, dxFeed. Its headline features need **MBO** (market-by-order: every
  individual resting order with an id), not just price-level depth. CME L2 is about $12/month extra.
- **Plans** (official page per search snippets, yearly billing): Orderflow $45/mo, **Advanced**
  (was "Full") $69/mo, **Pro** $125/mo. DeepDom heatmap is a separate licence, $39/mo or $29/mo
  yearly. 1-year bundle $1,599.
- **What each tier adds:**
  - Orderflow: footprint charts, volume profile, DOM ladder, VWAP, delta, 80+ indicators, browser
    and desktop.
  - Advanced: the proprietary indicators (Deep-M Effort, Deep Profile footprint and others).
  - Pro: Deep Trades (big MBO orders classified with 4 symbols, plus imbalance, cumulative delta and
    price/flow divergence), Deep V-Tracker (mechanics not public), DeepGamma (SPX gamma exposure
    from Cboe data), **Pattern Builder + auto-backtester** (no-code order-flow rules with trailing
    stops, multiple targets and break-even).
  - DeepDom: MBO liquidity heatmap, Liquidity Tracker (book reloading behind a move), Stoprun
    detector, **Iceberg detector**, Market Regime, MBO indicators, backtester and journal, freeze.
- **USP they sell:** a trader-brand (Fabio Valentini, "Fabervaale") with courses and live sessions
  wrapped around the software; MBO-level detail at retail prices; prop-firm friendly.
- **Weak spots reviewers name:** no AI analysis, limited backtesting and paper trading on lower
  tiers, no mobile app, steep learning curve. No independent performance data for any indicator.

### Bookmap (futures, stocks, crypto)

- **Plans:** Digital free (crypto data free with no time limit, delayed stocks and futures);
  Global $49/mo ($39 yearly, $990 lifetime); Global+ $99/mo ($79 yearly, $1,990 lifetime) adds chart
  trading, Large Lot Tracker, Strength indicator; Global Premium $199/mo reported, unconfirmed.
  Futures and stock data billed separately.
- **USP:** the original high-resolution liquidity heatmap with full history and replay, traded
  volume bubbles, CVD, order-book imbalance, an add-on marketplace (Java API).

### LuxAlgo (TradingView indicators)

- **Plans:** Premium $67.99/mo ($39.99 yearly), Ultimate $119.99/mo ($59.99 yearly), plus Essential
  and AI Ultra. Many indicators free, including a popular free Smart Money Concepts script.
- **What paid adds:** three toolkits (Signals & Overlays, Price Action Concepts with order blocks,
  BOS/CHoCH, FVG, liquidity, premium/discount; Oscillator Matrix), more alerts, an AI backtesting
  assistant and a "Quant" agent that writes Pine Script from plain English.
- **USP:** one-click SMC overlays on TradingView, alerts, a big community. Cheaper clones exist
  (Quantum Algo $19/mo, ChartPrime, TradingFinder, many free ICT scripts).

### Crypto-native order-flow and derivatives tools

| Tool                     | Free                                                | Paid                         | USP                                                                                                      |
| ------------------------ | --------------------------------------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------- |
| CoinGlass                | most dashboards; liquidation heatmap BTC/ETH only   | Prime $28/mo, API $29–699/mo | liquidation heatmap and map, OI, funding, long/short ratios across exchanges (owned by CMC since 9/2026) |
| Hyblock Capital          | none confirmed                                      | price not published          | modelled liquidation levels by leverage tier (25x/50x/100x) and position size                            |
| Exocharts                | web tier: 3 pairs, 1 candle type (reported)         | about €28/mo                 | crypto footprint, delta, volume profile                                                                  |
| OpenMarket (ex-Kiyotaka) | same live data as paid, fewer slots, shallower book | Plus (price not public)      | 4,000+ pairs on 29 venues, heatmap, footprint, 200 alerts free                                           |
| Velo                     | dashboards and chart (sources disagree)             | API $199/mo                  | derivatives and options data, CME, Python SDK                                                            |
| aggr.trade               | **all free, open source**                           | none                         | live aggregated trades and liquidations across exchanges in the browser                                  |
| TradingLite              | —                                                   | **shut down**                | was the crypto heatmap leader; its users are looking for a replacement                                   |

## 2. What really works (evidence, not marketing)

1. **Order blocks and SMC alone show no proven edge.** The only significance-tested study found
   (StatOasis, 736 order-block events on US index ETFs) had t = +1.22, below the bar of 2, and no
   variant beat buy-and-hold. A 738-asset test (indicatoredge.io) found a 40% median win rate for
   order blocks and −6.5% average alpha. Vendor pages quote 45% and 84% for the same setup on
   BTC 4h. Nobody publishes n, a confidence range and costs together.
2. **Win rate without expectancy misleads.** A liquidity-sweep setup won 71.9% of trades and still
   lost to buy-and-hold. This is exactly the gap our setup card already covers (n, Wilson range,
   break-even comparison) and nobody else does.
3. **Order-flow tools sell visibility, not edge.** Footprint, heatmap and CVD show who is
   aggressive and where liquidity rests. Reviewers value them for **timing and invalidation**
   (stop placement, "absorption at my level"), not prediction. No vendor publishes measured
   results for its iceberg, stop-run or V-Tracker signals.
4. **Liquidation maps are estimates.** Hyblock says so itself: it sees positions open but not
   early closes, so real liquidations are fewer than drawn. Label them estimates (guardrail 3).
5. **Visible orders can be spoofed.** Heatmap walls appear and vanish; a level only matters if it
   holds when traded into (that is what iceberg and absorption detectors try to measure).
6. **What people pay for in practice:** a cheap, fast, clean heatmap (TradingLite's exit left a
   gap), footprint + CVD, liquidation data, alerts, and education. AI features are marketing so far.

**Our USP falls out of this:** every competitor _draws_ the concept; none _measures_ it. GreenMTM
can offer the same views free for crypto and attach a measured record to each one ("absorption
at a 4h demand zone: n = 212, win 54% (47–61%), break-even 41%"). That is the mission in
CLAUDE.md, and it is the one thing that is hard to copy.

## 3. How each feature is built, and our free data for it

All sources below are public, keyless endpoints already in use or of the same kind
(`docs/context/TOOLING.md` → data sources). Binance history comes from `data.binance.vision`.

| Feature                        | How it works                                                                                                                                                                                                        | Free crypto data                                                                                                                 | What we have                                                   |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| **Delta and CVD**              | per candle: aggressive buy volume − aggressive sell volume (trade side from the taker flag); CVD is the running sum; divergence = price makes a new high, CVD does not                                              | Binance `aggTrade` (`m` = buyer is maker), OKX `trades`; history: `aggTrades` archive; quick version: kline `takerBuyBaseVolume` | ✅ chart (2026-11-17)                                          |
| **Footprint chart**            | bucket each candle's trades by price tick: bid volume × ask volume per row, imbalance where one side ≥ 3× the diagonal neighbour, point of control per candle                                                       | same trade streams, price bucket = N ticks or a fraction of ATR                                                                  | nothing                                                        |
| **Big trades / bubbles**       | group trades with the same timestamp and side (one taker order split across makers), flag when the notional is in the top 1% of the last N hours                                                                    | `aggTrade` (already aggregated by taker order)                                                                                   | ✅ chart (2026-11-17)                                          |
| **Liquidity heatmap**          | snapshot the book every 100–500 ms, store (time, price bucket, size), render as a time × price texture with log colour scaling                                                                                      | Binance depth 1000, OKX 400 levels; server recording for history                                                                 | ✅ live, browser-only, shallow (STATUS issue 5)                |
| **Absorption**                 | at one price level: large aggressive volume, price barely moves, the resting size stays (or refills)                                                                                                                | trades + book diffs                                                                                                              | nothing                                                        |
| **Iceberg (MBP heuristic)**    | volume traded at a level exceeds the size that was visible there, and the level refills within ms after each fill. True MBO detection needs order ids                                                               | Binance/OKX are price-level only; order-level books: Bitfinex raw books (public), Coinbase/Kraken L3 (free key, owner approval)  | nothing                                                        |
| **Stop run / sweep**           | price trades through a known swing high/low or pool, a burst of aggressive volume and liquidations, then closes back inside                                                                                         | swings from `analysis/swings.py`, liquidations `!forceOrder@arr`, OKX `liquidation-orders`                                       | swings, liquidity pools, sweeps partly in `smc.py`             |
| **Liquidation feed**           | stream forced orders, sum per candle, mark large ones                                                                                                                                                               | Binance `!forceOrder@arr` (undercounts, 1/s per symbol), OKX `liquidation-orders`                                                | Dashboard liquidations panel                                   |
| **Liquidation map (estimate)** | when open interest rises during a candle, assume new positions at that price split across leverage tiers; liq price ≈ entry × (1 − 1/lev + mmr) for longs, mirrored for shorts; remove a band when price crosses it | Binance `openInterest` + `/futures/data/openInterestHist` (30 days), long/short ratios, OKX `open-interest`                      | nothing                                                        |
| **OI, funding, basis panels**  | plot OI change against price (rising price + rising OI = new longs, etc.), funding percentile, perp−spot basis                                                                                                      | public REST on all three exchanges                                                                                               | funding live; OI/basis in ROADMAP P2 features                  |
| **Order blocks, FVG, BOS**     | last opposite candle before a displacement that breaks structure; FVG = gap between candle 1 high and candle 3 low                                                                                                  | candles                                                                                                                          | ✅ `analysis/smc.py`, with statistics                          |
| **Pattern builder + backtest** | no-code rules ("CVD divergence AND at demand zone AND sweep") run through the backtester, report with costs                                                                                                         | everything above                                                                                                                 | stats job; ROADMAP P1a "versioned rule presets", P2 backtester |
| **Alerts**                     | server-side rules on any of the above, Telegram/push                                                                                                                                                                | —                                                                                                                                | browser alerts; server alerts are STATUS next-up 2             |

How the vendors deliver it: DeepCharts and Bookmap are native desktop apps (Bookmap's add-on API is
Java) reading paid futures feeds; DeepCharts adds a browser version. The crypto tools are web apps
with WebGL charts and a server that records books and trades for every pair. For us: detectors and
statistics in Python (`backend/src/tcs/analysis/`, as for every rule), live drawing in the browser,
heatmap rendering per the flowmap candidate in TOOLING.

## 4. Rebuild order (free, crypto, measured)

Ordered by value ÷ effort. Each detector that produces a signal goes through `engine.analyze`,
gets a mirrored twin and invariant tests, and shows up in Pattern stats; display-only views do not.

1. **Delta, CVD and big trades on the chart.** ✅ Display shipped 2026-11-17: delta is exact per
   candle from kline taker volume; big trades are merged from `aggTrade` (live only, since the
   page opened). 1b ✅: measured as setup context (rule set r2). First result (4h, 10 coins,
   2 years): delta with the trade lifts the pooled win rate from 34% (against) to 40%, CVD
   divergence from 37% to 41%, but no bucket turns expectancy positive and per setup the
   differences are at chance level. Order flow helps a little at the margin; it is not an edge.
2. **Footprint chart** for the visible range (live trades + `aggTrades` archive for history).
3. **Server-side heatmap recording** (Parking lot) so history survives a reload and depth can be
   studied; deeper books via snapshot + diff sync.
4. **Liquidation feed + OI/funding panels** on the chart, then the **estimated liquidation map**,
   labelled "estimate".
5. **Absorption, stop-run and MBP-iceberg detectors** as measured context ("order block + sweep +
   absorption" vs order block alone). This is where we can show whether order flow adds anything.
6. **Rule builder + backtester** (ROADMAP P1a presets, P2 backtester) with costs and the
   random-entry baseline, so a user's combination gets an honest record instead of a pretty curve.

Not copied: brand or indicator names (DeepGamma, Deep Trades, Fabervaale), course content,
GPL code (aggr is GPL-3.0 per its predecessor: reference only), options-gamma data (no free
equivalent for crypto beyond Deribit, out of scope for now).
