# M7 · Risk manager

**Status:** ⬜ Not started. It has the final say: it can veto anything and nothing overrides it.

## Responsibilities
- Position sizing from account equity and stop distance.
- Portfolio limits: total open risk, per-symbol and per-direction exposure, correlation clusters.
- Circuit breakers: daily/weekly loss limits, consecutive-loss pause, kill switch.
- Liquidity sanity: position size relative to book depth and 24 h volume.

## Flow

```mermaid
flowchart TB
  C["candidate from M6"] --> SZ["size = equity × risk% ÷ stop distance"]
  SZ --> L1{"daily / weekly<br/>loss limit hit?"}
  L1 -- yes --> V["VETO"]
  L1 -- no --> L2{"total open risk<br/>+ this > cap?"}
  L2 -- yes --> V
  L2 -- no --> L3{"correlated exposure<br/>> cap?"}
  L3 -- yes --> RED["reduce size or VETO"]
  L3 -- no --> L4{"size vs liquidity OK?"}
  RED --> L4
  L4 -- no --> V
  L4 -- yes --> OK["approved, sized candidate → M8"]
  V --> LOG["reason → M5 ledger"]
```

## Default limits (configurable)
| Rule | Default |
| --- | --- |
| Risk per trade | 0.5–1 % of equity |
| Total open risk | 3 % |
| Max correlated cluster risk | 2 % (e.g. BTC + ETH long counts as one cluster) |
| Daily loss limit | 3 % → no new confirmations until next day |
| Consecutive losses | 5 → pause 24 h |
| Size cap | ≤ 1 % of the symbol's 1-min average volume |

Sizing beyond fixed-fractional, such as capped fractional Kelly, is allowed only for strategies
with ≥ 200 OOS trades.

## Acceptance criteria
- [ ] Unit tests cover every veto path.
- [ ] No code path creates a confirmation without passing M7.
