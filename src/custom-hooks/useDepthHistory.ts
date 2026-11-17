import { useEffect, useState } from "react";
import type { DepthOut } from "../api/schema";
import { apiGet } from "../api/client";
import { LiquidityService } from "../services/LiquidityService";
import { columnsToSamples, type BookSample } from "../utils/liquidityHeatmap";

export interface DepthHistory {
  samples: BookSample[];
  /** The analysis service is recording this symbol (so a reload keeps the heatmap). */
  recording: boolean;
  /** Request state; "unavailable" when the analysis service is not running. */
  status: "idle" | "loading" | "ok" | "unavailable";
}

const IDLE: DepthHistory = { samples: [], recording: false, status: "idle" };
const LOADING: DepthHistory = { ...IDLE, status: "loading" };
/** Hours of recorded depth loaded when the heatmap is switched on. */
export const DEPTH_HISTORY_MINUTES = 6 * 60;

/**
 * Order-book history recorded by the analysis service, loaded once when the heatmap layer is
 * switched on (`symbol` null = off). Asking also starts recording a symbol the service was not
 * recording yet, so the next reload has history. The live sampler adopts the recorded bucket so
 * history and live columns line up.
 */
export function useDepthHistory(symbol: string | null): DepthHistory {
  const [state, setState] = useState<{ symbol: string | null; value: DepthHistory }>({
    symbol: null,
    value: IDLE,
  });
  useEffect(() => {
    if (!symbol) return;
    let cancelled = false;
    apiGet<DepthOut>(`/depth/${symbol}`, { minutes: DEPTH_HISTORY_MINUTES })
      .then((body) => {
        if (cancelled) return;
        const samples = columnsToSamples(body.columns);
        const last = samples[samples.length - 1];
        if (last) LiquidityService.getInstance().preferBucket(last.bucket);
        setState({ symbol, value: { samples, recording: body.recording, status: "ok" } });
      })
      .catch(() => {
        if (!cancelled) setState({ symbol, value: { ...IDLE, status: "unavailable" } });
      });
    return () => {
      cancelled = true;
    };
  }, [symbol]);
  if (symbol === null) return IDLE;
  return state.symbol === symbol ? state.value : LOADING;
}
