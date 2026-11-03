import type { ConnectionState } from "../types/connection";

/** Failed reconnects in a row after which an exchange is shown as down. */
export const DOWN_AFTER_FAILED_RECONNECTS = 3;

/**
 * State to report when a socket closes. Sockets retry forever, so a close is
 * "connecting" until several reconnects in a row have failed; then the exchange is
 * reported "down" (it still retries and returns to "live" on the next open).
 */
export function stateAfterClose(
  failedReconnects: number,
  threshold = DOWN_AFTER_FAILED_RECONNECTS,
): ConnectionState {
  return failedReconnects >= threshold ? "down" : "connecting";
}
