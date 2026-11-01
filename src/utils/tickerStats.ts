/**
 * Pure parsers for exchange 24h-ticker REST payloads.
 *
 * Kept free of fetch/IO so a live exchange response can be fed straight back
 * in a unit test (JSON fixtures), and so the dashboard stats never depend on
 * malformed payloads sneaking past validation.
 */

export interface ParsedTickerStats {
  /** 24h change in percent (already expressed as a percentage number). */
  changePercent: number | null;
  /** 24h traded volume in base-asset units (e.g. BTC). */
  volumeBase: number | null;
}

function finiteNumber(v: unknown): number | null {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const n = typeof v === "string" ? parseFloat(v) : v;
  return Number.isFinite(n) ? n : null;
}

/**
 * Binance 24hr ticker (spot: /api/v3/ticker/24hr, futures: /fapi/v1/ticker/24hr).
 * `priceChangePercent` is already a percent string (e.g. "-0.186").
 */
export function parseBinance24hTicker(json: unknown): ParsedTickerStats | null {
  if (typeof json !== "object" || json === null) return null;
  const row = json as { priceChangePercent?: string; volume?: string };
  const changePercent = finiteNumber(row.priceChangePercent);
  const volumeBase = finiteNumber(row.volume);
  if (changePercent === null && volumeBase === null) return null;
  return { changePercent, volumeBase };
}

/**
 * OKX single ticker (/api/v5/market/ticker): reports `last` and `open24h`
 * rather than a precomputed percent; volume (`volCcy24h`) is in base units.
 */
export function parseOkx24hTicker(json: unknown): ParsedTickerStats | null {
  if (
    typeof json !== "object" ||
    json === null ||
    typeof (json as { data?: unknown }).data !== "object"
  ) {
    return null;
  }
  const data = (json as { data?: unknown }).data;
  if (!Array.isArray(data) || data.length === 0) return null;
  const row = data[0] as { last?: string; open24h?: string; volCcy24h?: string };
  const last = finiteNumber(row.last);
  const open24h = finiteNumber(row.open24h);

  let changePercent: number | null = null;
  if (last !== null && open24h !== null && open24h > 0) {
    changePercent = ((last - open24h) / open24h) * 100;
  }

  const volumeBase = finiteNumber(row.volCcy24h);
  if (changePercent === null && volumeBase === null) return null;
  return { changePercent, volumeBase };
}
