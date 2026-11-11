"""`uv run tcs-api` starts the API on http://127.0.0.1:8000 (the Vite dev server proxies /tcs)."""

from __future__ import annotations

import os

import uvicorn

from tcs.api.app import create_app

app = create_app()


def run() -> None:
    uvicorn.run(
        "tcs.api.main:app",
        host=os.environ.get("TCS_HOST", "127.0.0.1"),
        port=int(os.environ.get("TCS_PORT", "8000")),
    )
