import { describe, expect, it } from "vite-plus/test";
import type { SetupOccurrence, SetupStats } from "../../types/analysis";
import type { CurrentSetup, Scan } from "../setupAnalysis";
import {
  matchFirings,
  parseFirings,
  parseRules,
  resolveOutcome,
  WATCHLIST,
  type SetupAlertRule,
} from "../setupAlerts";

const H4 = 14_400_000;

const pooled = (verdict: SetupStats["verdict"]) =>
  ({ n: 212, wins: 129, winRate: 0.61, ci: [0.54, 0.67], verdict }) as SetupStats;

function occ(symbol: string, time: number, result: SetupOccurrence["outcome"]["result"] = "open") {
  return {
    symbol,
    hit: {
      type: "doubleBottom",
      index: 10,
      entry: 100,
      stop: 95,
      target: 110,
      low: 95,
      points: [],
    },
    location: "demandZone",
    outcome: { result, exitIndex: null, movePct: 0, r: 0, bars: 0 },
    time,
  } as SetupOccurrence;
}

function current(symbol: string, time: number, verdict: SetupStats["verdict"] = "edge") {
  return { occurrence: occ(symbol, time), pooled: pooled(verdict), own: pooled(verdict) };
}

const rule = (over: Partial<SetupAlertRule> = {}): SetupAlertRule => ({
  id: "r1",
  symbol: "BTC-USDT",
  setupKey: "doubleBottom|demandZone",
  interval: "4h",
  telegram: true,
  inApp: true,
  edgeOnly: false,
  paused: false,
  createdAt: 100 * H4,
  ...over,
});

describe("matchFirings", () => {
  const now = 103 * H4;
  const cur: CurrentSetup[] = [current("BTC-USDT", 101 * H4), current("ETH-USDT", 101 * H4)];

  it("fires for a matching coin, setup and timeframe with the pooled record", () => {
    const f = matchFirings([rule()], cur, "4h", [], new Set(), now);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({
      id: `r1|BTC-USDT|${101 * H4}`,
      symbol: "BTC-USDT",
      entry: 100,
      record: { n: 212, wins: 129, verdict: "edge" },
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
      matchFirings([rule({ setupKey: "hammer|demandZone" })], cur, "4h", [], new Set(), now),
    ).toEqual([]);
    // candle 98 closed at 99·H4, before the rule was created at 100·H4
    expect(
      matchFirings([rule()], [current("BTC-USDT", 98 * H4)], "4h", [], new Set(), now),
    ).toEqual([]);
  });

  it("respects edge-only rules", () => {
    const noEdge = [current("BTC-USDT", 101 * H4, "noEdge")];
    expect(matchFirings([rule({ edgeOnly: true })], noEdge, "4h", [], new Set(), now)).toEqual([]);
    expect(matchFirings([rule()], noEdge, "4h", [], new Set(), now)).toHaveLength(1);
  });

  it("marks delivery off when the rule has no Telegram", () => {
    const f = matchFirings([rule({ telegram: false, inApp: false })], cur, "4h", [], new Set(), 0);
    expect(f[0]).toMatchObject({ telegram: "off", unseen: false });
  });
});

describe("resolveOutcome", () => {
  it("reads the outcome of the same occurrence from a newer scan", () => {
    const [firing] = matchFirings(
      [rule()],
      [current("BTC-USDT", 101 * H4)],
      "4h",
      [],
      new Set(),
      0,
    );
    const scan = {
      analyses: new Map([
        [
          "BTC-USDT",
          { symbol: "BTC-USDT", zones: [], occurrences: [occ("BTC-USDT", 101 * H4, "win")] },
        ],
      ]),
      pooled: new Map(),
      current: [],
    } as Scan;
    expect(resolveOutcome(firing, scan)).toBe("win");
    expect(resolveOutcome({ ...firing, symbol: "SOL-USDT" }, scan)).toBe("open");
  });
});

describe("storage parsing", () => {
  it("round-trips valid rules and drops invalid ones", () => {
    const good = rule();
    const parsed = parseRules([
      good,
      { ...good, id: "r2", symbol: "not a symbol" },
      { ...good, id: "r3", setupKey: "moon|demandZone" },
      { ...good, id: "r4", interval: "5m" },
      { ...good },
      "junk",
    ]);
    expect(parsed).toEqual([good]);
    expect(parseRules(null)).toEqual([]);
  });

  it("round-trips valid firings", () => {
    const f = matchFirings([rule()], [current("BTC-USDT", 101 * H4)], "4h", [], new Set(), 5);
    expect(parseFirings(JSON.parse(JSON.stringify(f)))).toEqual(f);
    expect(parseFirings([{ ...f[0], entry: "x" }])).toEqual([]);
  });
});
