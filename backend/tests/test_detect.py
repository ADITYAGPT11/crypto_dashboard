import numpy as np

from tcs.research.patterns.catalog import catalog, label_for
from tcs.research.patterns.detect import Event, events


def test_one_event_per_run_on_its_first_candle() -> None:
    sig = np.array([0, 1, 1, 1, 0, 1, -1, -1, 0], dtype=np.int8)
    assert events({"double_bottom": sig}) == [
        Event("double_bottom", 1, 1),
        Event("double_bottom", 5, 1),
        Event("double_bottom", 6, -1),
    ]


def test_catalog_drops_combined_duplicates_and_labels_names() -> None:
    c = catalog()
    assert "fakey" not in c and "fakey_bullish" in c and "fakey_bearish" in c
    assert "hs_bottom" in c and c["hs_bottom"].label == "Inverse head and shoulders"
    assert c["double_bottom"].kind == "chart" and c["double_bottom"].bias == "bullish"
    assert c["hammer"].kind == "candlestick"
    assert c["narrow_range_4"].kind == "short" and c["rising_volume_trend"].kind == "short"
    assert c["ascending_triangle"].kind == "chart" and c["gartley_bull"].kind == "chart"
    assert label_for("channel_asc") == "Channel ascending"
    assert label_for("flag_bull") == "Flag (bullish)"
    assert label_for("double_top_adam_eve") == "Double top (Adam & Eve)"
