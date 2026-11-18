"""Coins every setup is pooled across (liquid Binance USDⓈ-M perpetuals with long histories).

Mirrors ``RESEARCH_UNIVERSE`` in ``src/services/HistoryService.ts``.
"""

RESEARCH_UNIVERSE: tuple[str, ...] = (
    "BTC-USDT",
    "ETH-USDT",
    "SOL-USDT",
    "XRP-USDT",
    "BNB-USDT",
    "DOGE-USDT",
    "ADA-USDT",
    "AVAX-USDT",
    "LINK-USDT",
    "LTC-USDT",
)


#: More liquid perpetuals with over two years of Binance history, measured by the playbook only
#: (a bigger sample, and coins its rules were never looked at on). The dashboard and the
#: pattern statistics keep the research ten.
PLAYBOOK_EXTRA: tuple[str, ...] = (
    "TRX-USDT",
    "DOT-USDT",
    "BCH-USDT",
    "NEAR-USDT",
    "UNI-USDT",
    "ATOM-USDT",
    "ETC-USDT",
    "FIL-USDT",
    "APT-USDT",
    "ARB-USDT",
    "OP-USDT",
    "SUI-USDT",
    "INJ-USDT",
    "AAVE-USDT",
    "XLM-USDT",
)
PLAYBOOK_UNIVERSE: tuple[str, ...] = RESEARCH_UNIVERSE + PLAYBOOK_EXTRA


def to_exchange_symbol(symbol: str) -> str:
    """Canonical ``BASE-QUOTE`` to Binance's ``BASEQUOTE``."""
    return symbol.replace("-", "").upper()


def is_canonical(symbol: str) -> bool:
    parts = symbol.split("-")
    return len(parts) == 2 and all(p.isalnum() and p.isupper() for p in parts)
