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
        Order book ⬜
        Open interest ⬜
      Infra
        BaseWebSocketClient reconnect ✅
        Connection status 🚧 no down/stale
        Symbol search 🚧 filter bug
      Persistence ⬜
        Backend collector ⬜
        Time-series store ⬜
        Historical backfill ⬜
    Research ⬜
      Indicators / TA ⬜
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
    UI ✅
      Price table ✅
      Metrics + badges ✅
      Theme + routing ✅
    Dev workflow ✅
      CLAUDE.md context map ✅
      Build + lint ✅
      Tests ⬜
```
