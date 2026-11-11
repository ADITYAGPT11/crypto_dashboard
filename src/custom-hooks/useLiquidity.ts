import { useCallback, useSyncExternalStore } from "react";
import { LiquidityService, type LiquiditySnapshot } from "../services/LiquidityService";

const IDLE: LiquiditySnapshot = {
  symbol: null,
  feeds: {
    BINANCE: { state: "connecting", levels: 0, error: null },
    OKX: { state: "connecting", levels: 0, error: null },
  },
  samples: [],
  version: 0,
};

/** Live order-book samples for `symbol` (null = off: no sockets are opened). */
export function useLiquidity(symbol: string | null): LiquiditySnapshot {
  const svc = LiquidityService.getInstance();
  const subscribe = useCallback(
    (cb: () => void) => (symbol ? svc.subscribe(symbol, cb) : () => {}),
    [svc, symbol],
  );
  const get = useCallback(() => (symbol ? svc.getSnapshot() : IDLE), [svc, symbol]);
  return useSyncExternalStore(subscribe, get, get);
}
