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


def to_exchange_symbol(symbol: str) -> str:
    """Canonical ``BASE-QUOTE`` to Binance's ``BASEQUOTE``."""
    return symbol.replace("-", "").upper()


def is_canonical(symbol: str) -> bool:
    parts = symbol.split("-")
    return len(parts) == 2 and all(p.isalnum() and p.isupper() for p in parts)
