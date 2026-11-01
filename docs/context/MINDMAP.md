# Mind map

Renders as a diagram on GitHub (Mermaid). For an interactive, collapsible version paste the code
block's contents into <https://mermaid.live>.
Legend: ✅ built · 🚧 partial / has known issues · ⬜ planned.

```mermaid
mindmap
  root((Trade Confirmation System))
    Data layer 🚧
      Exchanges
        Binance spot + futures ✅
        OKX spot + swap ✅
        Delta India perps 🚧 USD vs USDT
      Streams
        Last trade price ✅
        Funding rate + countdown ✅
        Candles + REST backfill ✅
        Order book top-20 🚧 Binance only
        Trade prints 🚧 Binance only
        24h stats 🚧 no Delta
        Open interest ⬜
      Infra
        BaseWebSocketClient reconnect ✅
        Connection status 🚧 no down
        Cell freshness / stale ✅
        Symbol search 🚧 filter bug
      Persistence ⬜
        TS backend prototype 🚧 frozen
        Python collector ⬜
        QuestDB store ⬜
        Historical backfill ⬜
    Research ⬜
      Indicators / TA 🚧 in browser
      Alert replay 🚧 TS prototype
      Funding & basis analytics ⬜
      Statistics & probability ⬜
      Backtesting engine ⬜
        Fees slippage funding ⬜
        Walk-forward OOS ⬜
    Signals ⬜
      Funding carry ⬜
      Cross-exchange spread ⬜
      Trend / mean reversion ⬜
      Confidence score ⬜
    Validation ⬜
      Forward / paper testing ⬜
      Live vs backtest drift ⬜
    News impact ⬜
      News + sentiment feed ⬜
      Event calendar ⬜
      Impact measurement ⬜
    Risk management ⬜
      Position sizing ⬜
      Exposure + correlation ⬜
      Loss limits + kill switch ⬜
    Confirmation output ⬜
      Signal + evidence + risk + news ⬜
    UI 🚧 crashes on load
      Price table ✅
      Charts + indicators ✅
      Order book panel ✅
      Spread panel 🚧 no fees
      Alerts rule builder ✅
      Telegram delivery 🚧
      Layout + watchlist saved ✅
    Dev workflow ✅
      CLAUDE.md context map ✅
      Build + typecheck ❌ 65 errors
      Tests ✅ 191
      CI ⬜
```
