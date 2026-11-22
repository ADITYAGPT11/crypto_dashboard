"""``tcs serve | backfill | openapi | ts-types``."""

from __future__ import annotations

import argparse
import json
import logging
import sys
import time

from tcs.common.timeframes import parse_timeframe
from tcs.config import Settings


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(prog="tcs", description=__doc__)
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("serve", help="run the API")
    bf = sub.add_parser("backfill", help="download history into the store")
    bf.add_argument("tf", nargs="*", default=["1h", "4h", "1d"])
    sub.add_parser("openapi", help="print the OpenAPI document")
    sub.add_parser("ts-types", help="print TypeScript interfaces for the API (src/api/schema.ts)")
    args = p.parse_args(argv)
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s"
    )
    settings = Settings()

    if args.cmd == "serve":
        import uvicorn

        from tcs.api.app import create_app

        uvicorn.run(create_app(settings), host=settings.host, port=settings.port)
    elif args.cmd == "backfill":
        from tcs.marketdata.history import History
        from tcs.store.sqlite import Store

        h = History(Store(settings.db_path))
        now = int(time.time() * 1000)
        for tf in args.tf:
            for symbol in settings.universe:
                c = h.ensure(
                    symbol, parse_timeframe(tf), now - settings.history_days * 86_400_000, now
                )
                print(f"{symbol} {tf}: {c.count} candles, {c.gaps} gaps, {c.behind} behind")
    elif args.cmd == "openapi":
        from tcs.api.app import create_app

        app = create_app(Settings(record_depth=False))
        json.dump(app.openapi(), sys.stdout, indent=1, sort_keys=True)
        sys.stdout.write("\n")
    elif args.cmd == "ts-types":
        from tcs.api.app import create_app
        from tcs.api.ts_types import generate

        sys.stdout.write(generate(create_app(Settings(record_depth=False)).openapi()))


if __name__ == "__main__":
    main()
