"""Frozen real history: any rule change shows up here as a reviewed diff.

If this fails after an intended rule change, bump ``RULESET_VERSION`` and
regenerate the snapshot: ``uv run python -m tests.test_golden``.
"""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

from tcs.analysis.catalog import RULESET_VERSION
from tcs.analysis.engine import analyze

from .helpers import real_eth_4h

SNAPSHOT = Path(__file__).parent / "fixtures" / "golden_eth_4h.json"


def snapshot() -> dict[str, object]:
    a = analyze(real_eth_4h())
    hits = Counter(f"{o.hit.pattern}|{o.location}|{o.outcome.result}" for o in a.occurrences)
    lv = a.levels
    return {
        "ruleset": RULESET_VERSION,
        "candles": len(a.series),
        "hits": dict(sorted(hits.items())),
        "zones": len(lv.zones),
        "orderBlocks": len(lv.order_blocks),
        "fvgs": len(lv.fvgs),
        "structureBreaks": len(lv.structure),
    }


def test_matches_golden_snapshot() -> None:
    assert json.loads(SNAPSHOT.read_text()) == snapshot()


if __name__ == "__main__":
    SNAPSHOT.write_text(json.dumps(snapshot(), indent=1) + "\n")
