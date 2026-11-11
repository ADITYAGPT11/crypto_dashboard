"""The committed TypeScript client types match the API (regenerate: ``npm run api:types``)."""

from __future__ import annotations

from pathlib import Path

from tcs.api.app import create_app
from tcs.api.ts_types import generate
from tcs.config import Settings

SCHEMA_TS = Path(__file__).parents[2] / "src" / "api" / "schema.ts"


def test_schema_ts_is_up_to_date() -> None:
    expected = generate(create_app(Settings(schedule=False)).openapi())
    assert SCHEMA_TS.read_text() == expected, "run `npm run api:types` and commit src/api/schema.ts"
