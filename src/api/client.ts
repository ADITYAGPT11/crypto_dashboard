/**
 * Client for the Python analysis API (`backend/`, `npm run api`). In development
 * Vite proxies `/api/v1` to it (vite.config.ts), so the browser stays same-origin.
 */

export const API_BASE = "/api/v1";
const TIMEOUT_MS = 30_000;

export class ApiError extends Error {
  constructor(
    message: string,
    /** HTTP status, or null when the service could not be reached. */
    readonly status: number | null,
  ) {
    super(message);
    this.name = "ApiError";
  }

  get offline(): boolean {
    return (
      this.status === null || this.status === 502 || this.status === 503 || this.status === 504
    );
  }
}

export const OFFLINE_HINT =
  "The analysis service isn't running. Start it with `npm run api` (Python backend on :8000).";

export type Query = Record<string, string | number | undefined>;

export function apiUrl(path: string, query: Query = {}): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== "") qs.set(k, String(v));
  const s = qs.toString();
  return `${API_BASE}${path}${s ? `?${s}` : ""}`;
}

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export async function apiGet<T>(
  path: string,
  query: Query = {},
  fetcher: Fetcher = (u, i) => fetch(u, i),
): Promise<T> {
  let res: Response;
  try {
    res = await fetcher(apiUrl(path, query), { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new ApiError(OFFLINE_HINT, null);
  }
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { detail?: unknown };
      if (typeof body.detail === "string") detail = body.detail;
    } catch {
      // not JSON: the dev proxy's own error page when the service is down
    }
    const err = new ApiError(detail, res.status);
    throw err.offline || res.status === 500 ? new ApiError(OFFLINE_HINT, null) : err;
  }
  return (await res.json()) as T;
}
