/** Non-default inputs checked by the indicator golden test, besides the defaults. */
export const ALT_PARAMS: Partial<Record<string, Record<string, number>>> = {
  sma: { length: 50 },
  ema: { length: 21 },
  bb: { length: 10 },
  vwap: { length: 5 },
  psar: { step: 0.01, max: 0.1 },
  rsi: { length: 7 },
  macd: { fast: 5, slow: 35, signal: 5 },
  stoch: { k: 5, d: 5 },
  atr: { length: 7 },
};
