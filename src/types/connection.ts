export type ConnectionState = "connecting" | "live" | "down";

export interface ConnectionStatusPayload {
  exchange: string;
  market: string;
  state: ConnectionState;
}
