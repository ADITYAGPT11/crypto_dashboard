"""Which ta_patterns detectors we run, and how they are named in the UI.

Source: ta_patterns 1.2.1 (MIT), audited in docs/context/TOOLING.md. Every detector returns
+1 / -1 / 0 per candle and is point-in-time safe (tests/test_no_lookahead.py re-checks it).
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import cache
from typing import Literal

import ta_patterns as tap
import ta_patterns.chart_patterns as cp

Kind = Literal["chart", "short", "candlestick"]
Bias = Literal["bullish", "bearish", "neutral"]
KINDS: tuple[Kind, ...] = ("chart", "short", "candlestick")

# ta_patterns' chart list mixes multi-week formations with 1-3 candle "event" patterns
# (Bulkowski's short-term and volume patterns). Formations are "chart"; the rest are "short",
# so the Chart can show formations without ~5 short-term flags on every candle.
_SHORT_MODULES = {"short", "volume"}

# Readable names where the snake_case id is cryptic.
_LABELS: dict[str, str] = {
    "hs_top": "Head and shoulders top",
    "hs_bottom": "Inverse head and shoulders",
    "complex_hs_top": "Complex head and shoulders top",
    "complex_hs_bottom": "Complex inverse head and shoulders",
    "busted_hs_top": "Busted head and shoulders top",
    "busted_hs_bottom": "Busted inverse head and shoulders",
    "abcd_bull": "AB=CD bullish",
    "abcd_bear": "AB=CD bearish",
    "abc_correction": "ABC correction",
    "big_m": "Big M",
    "big_w": "Big W",
    "flag_high_tight": "High and tight flag",
    "shark_32": "Shark-32",
    "three_dc": "Three-day compression (3DC)",
    "three_lr_bullish": "Three lower lows (bullish)",
    "three_lr_bearish": "Three higher highs (bearish)",
    "narrow_range_4": "Narrow range 4 (NR4)",
    "narrow_range_7": "Narrow range 7 (NR7)",
    "two_b_top": "2B top",
    "two_b_bottom": "2B bottom",
    "one_two_three_top": "1-2-3 top",
    "one_two_three_bottom": "1-2-3 bottom",
    "gap2h": "Gap 2H",
    "gap2h_inverted": "Gap 2H inverted",
}


def _chart_kind(name: str) -> Kind:
    fn = getattr(cp, name, None)
    module = getattr(fn, "__module__", "") or ""
    return "short" if module.rsplit(".", 1)[-1] in _SHORT_MODULES else "chart"


@dataclass(frozen=True)
class PatternInfo:
    name: str
    label: str
    kind: Kind
    bias: Bias


def label_for(name: str) -> str:
    if name in _LABELS:
        return _LABELS[name]
    for shape in ("adam_adam", "adam_eve", "eve_adam", "eve_eve"):
        if name.endswith("_" + shape):
            first, second = (w.capitalize() for w in shape.split("_"))
            return f"{label_for(name[: -len(shape) - 1])} ({first} & {second})"
    text = name.replace("_", " ")
    for a, b in ((" bull", " (bullish)"), (" bear", " (bearish)")):
        if text.endswith(a):
            text = text[: -len(a)] + b
    for a, b in ((" asc", " ascending"), (" desc", " descending"), (" inv", " inverted")):
        text = text.replace(a + " ", b + " ")
        if text.endswith(a):
            text = text[: -len(a)] + b
    return text[0].upper() + text[1:]


def _is_combined(name: str, names: set[str]) -> bool:
    """`fakey` duplicates `fakey_bullish` + `fakey_bearish`; keep only the directional halves."""
    pairs = (("_bullish", "_bearish"), ("_bottom", "_top"), ("_upside", "_downside"))
    if name == "gap2h_combined":
        return True
    return any(f"{name}{a}" in names and f"{name}{b}" in names for a, b in pairs)


@cache
def catalog() -> dict[str, PatternInfo]:
    out: dict[str, PatternInfo] = {}
    sources: tuple[tuple[Kind | None, list[str], set[str], set[str]], ...] = (
        (
            None,  # chart or short, decided per detector
            cp.chart_list_patterns("all"),
            set(cp.chart_list_patterns("bullish")),
            set(cp.chart_list_patterns("bearish")),
        ),
        (
            "candlestick",
            tap.list_patterns("all"),
            set(tap.list_patterns("bullish")),
            set(tap.list_patterns("bearish")),
        ),
    )
    for kind, names, bulls, bears in sources:
        all_names = set(names)
        for name in names:
            if _is_combined(name, all_names):
                continue
            bias: Bias = "bullish" if name in bulls else "bearish" if name in bears else "neutral"
            k: Kind = kind if kind is not None else _chart_kind(name)
            out[name] = PatternInfo(name, label_for(name), k, bias)
    return out
