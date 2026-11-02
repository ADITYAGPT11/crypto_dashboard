import { describe, expect, it } from "vite-plus/test";
import { isLeveragedToken, toCanonicalSymbols } from "../symbolUtils";

describe("isLeveragedToken", () => {
  const listed = new Set(["BTC", "ETH", "JUP", "SUPER", "BTCUP", "ETHBULL", "UP", "BULL"]);

  it("flags a listed base plus a leveraged suffix", () => {
    expect(isLeveragedToken("BTCUP", listed)).toBe(true);
    expect(isLeveragedToken("ETHBULL", listed)).toBe(true);
    expect(isLeveragedToken("BTCDOWN", listed)).toBe(true);
    expect(isLeveragedToken("ETHBEAR", listed)).toBe(true);
  });

  it("keeps real coins that only contain the letters", () => {
    expect(isLeveragedToken("JUP", listed)).toBe(false);
    expect(isLeveragedToken("SUPER", listed)).toBe(false);
    expect(isLeveragedToken("BTC", listed)).toBe(false);
  });

  it("keeps a coin named exactly like a suffix", () => {
    expect(isLeveragedToken("UP", listed)).toBe(false);
    expect(isLeveragedToken("BULL", listed)).toBe(false);
  });
});

describe("toCanonicalSymbols", () => {
  it("drops leveraged tokens, de-duplicates and sorts", () => {
    expect(toCanonicalSymbols(["SUPER", "BTC", "BTCUP", "JUP", "BTC", "BTCDOWN"], "USDT")).toEqual([
      "BTC-USDT",
      "JUP-USDT",
      "SUPER-USDT",
    ]);
  });
});
