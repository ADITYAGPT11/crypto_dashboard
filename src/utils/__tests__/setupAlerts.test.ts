import { describe, expect, it } from "vite-plus/test";
import type { SetupOccurrence } from "../../types/analysis";
import {
  matchFirings,
  parseFirings,
  parseRules,
  WATCHLIST,
  type CurrentSetup,
  type SetupAlertRule,
} from "../setupAlerts";

const H4 = 14_400_000;

function occ(symbol: string, time: number, pattern = "doubleBottom"): SetupOccurrence {
  return {
    symbol,
    pattern,
    direction: "long",
    location: "zone",
    time,
    startTime: time - 10 * 14_400_000,
    close: 100,
    extreme: 95,
    points: [],
    lines: [],
    score: 2,
    checks: [
      {
        id: "location",
        label: "At a bullish order block / demand zone",
        passed: true,
        detail: "at a zone",
      },
      { id: "rsi", label: "RSI 50-70: healthy momentum", passed: true, detail: "RSI 61" },
      { id: "volume", label: "Volume spike", passed: false, detail: "volume 1.0x average" },
    ],
  };
}

function current(symbol: string, time: number): CurrentSetup {
  return { occurrence: occ(symbol, time) };
}

const rule = (over: Partial<SetupAlertRule> = {}): SetupAlertRule => ({
  id: "r1",
  symbol: "BTC-USDT",
  setupKey: "doubleBottom|long|zone",
  interval: "4h",
  telegram: true,
  inApp: true,
  paused: false,
  createdAt: 100 * H4,
  ...over,
});

describe("matchFirings", () => {
  const now = 103 * H4;
  const cur: CurrentSetup[] = [current("BTC-USDT", 101 * H4), current("ETH-USDT", 101 * H4)];

  it("fires for a matching coin, setup and timeframe with its checklist", () => {
    const f = matchFirings([rule()], cur, "4h", [], new Set(), now);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({
      id: `r1|BTC-USDT|${101 * H4}`,
      symbol: "BTC-USDT",
      close: 100,
      score: 2,
      of: 3,
      met: ["At a bullish order block / demand zone", "RSI 50-70: healthy momentum"],
      telegram: "offline",
      unseen: true,
    });
  });

  it("fires once per occurrence", () => {
    const first = matchFirings([rule()], cur, "4h", [], new Set(), now);
    const again = matchFirings([rule()], cur, "4h", [], new Set(first.map((x) => x.id)), now);
    expect(again).toEqual([]);
  });

  it("covers watchlist coins only for WATCHLIST rules", () => {
    const f = matchFirings([rule({ symbol: WATCHLIST })], cur, "4h", ["ETH-USDT"], new Set(), now);
    expect(f.map((x) => x.symbol)).toEqual(["ETH-USDT"]);
  });

  it("skips paused rules, other timeframes, other setups and older candles", () => {
    expect(matchFirings([rule({ paused: true })], cur, "4h", [], new Set(), now)).toEqual([]);
    expect(matchFirings([rule({ interval: "1h" })], cur, "4h", [], new Set(), now)).toEqual([]);
    expect(
      matchFirings([rule({ setupKey: "hammer|long|zone" })], cur, "4h", [], new Set(), now),
    ).toEqual([]);
    // candle 98 closed at 99·H4, before the rule was created at 100·H4
    expect(
      matchFirings([rule()], [current("BTC-USDT", 98 * H4)], "4h", [], new Set(), now),
    ).toEqual([]);
  });

  it("marks delivery off when the rule has no Telegram", () => {
    const f = matchFirings([rule({ telegram: false, inApp: false })], cur, "4h", [], new Set(), 0);
    expect(f[0]).toMatchObject({ telegram: "off", unseen: false });
  });
});

describe("storage parsing", () => {
  it("round-trips valid rules and drops invalid ones", () => {
    const good = rule();
    const parsed = parseRules([
      good,
      { ...good, id: "r2", symbol: "not a symbol" },
      { ...good, id: "r3", setupKey: "moon|nowhere" },
      { ...good, id: "r4", interval: "5m" },
      { ...good },
      "junk",
      { ...good, id: "r5", setupKey: "hammer|demandZone" }, // stored before directions existed
    ]);
    expect(parsed).toEqual([good, { ...good, id: "r5", setupKey: "hammer|long|zone" }]);
    expect(parseRules(null)).toEqual([]);
  });

  it("round-trips valid firings", () => {
    const f = matchFirings([rule()], [current("BTC-USDT", 101 * H4)], "4h", [], new Set(), 5);
    expect(parseFirings(JSON.parse(JSON.stringify(f)))).toEqual(f);
    expect(parseFirings([{ ...f[0], time: "x" }])).toEqual([]);
  });

  it("keeps firings stored before the checklist, without their old trade plan", () => {
    const old = {
      id: "r1|BTC-USDT|1",
      ruleId: "r1",
      symbol: "BTC-USDT",
      setupKey: "doubleBottom|long|zone",
      interval: "4h",
      time: 1,
      firedAt: 2,
      entry: 100,
      stop: 95,
      target: 110,
      record: { n: 1, wins: 1, winRate: 1, ci: [0, 1], verdict: "tooFew" },
      outcome: "win",
      telegram: "sent",
      unseen: false,
    };
    expect(parseFirings([old])).toEqual([
      expect.objectContaining({ id: old.id, close: 0, score: 0, of: 0, met: [] }),
    ]);
  });
});
