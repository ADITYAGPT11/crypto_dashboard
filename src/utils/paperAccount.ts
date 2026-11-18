/**
 * A paper (dummy-money) account replaying the playbook's measured trades in time order, so
 * results read in dollars instead of R.
 *
 * R is the money risked on one trade: with a $10 000 account risking 1% per trade, 1R = $100.
 * A trade's dollar result is its R times the dollars risked when it was opened:
 *
 * - size (coins) = dollars risked / distance from entry to stop;
 * - profit = R after costs × dollars risked; fees = (R before costs − R after costs) × dollars
 *   risked (Binance fees and slippage, as measured);
 * - with compounding, each trade risks a share of the balance at the moment it is opened
 *   (trades still open count at nothing: only closed results move the balance).
 *
 * Display only: no orders, no exchange, nothing here feeds a statistic.
 */
import type { ForwardTradeOut, PaperTradeOut } from "../api/schema";

export interface PaperSettings {
  /** Starting balance in USDT. */
  start: number;
  /** Share of the balance risked per trade, percent (1 = 1%). */
  riskPct: number;
  /** Size each trade from the current balance (true) or always from the starting balance. */
  compound: boolean;
}

export const DEFAULT_PAPER: PaperSettings = { start: 10_000, riskPct: 1, compound: true };
export const RISK_CHOICES = [0.25, 0.5, 1, 2] as const;
export const PAPER_STORAGE_KEY = "paper:settings";

export interface PaperFill {
  trade: PaperTradeOut;
  /** Dollars at risk (1R) for this trade. */
  riskUsd: number;
  /** Position size in coins, and its value at entry. */
  qty: number;
  notional: number;
  /** Profit after costs, and the costs, in dollars. */
  pnl: number;
  fees: number;
  /** Balance once this trade closed. */
  balanceAfter: number;
}

export interface PaperResult {
  /** In the order the trades closed. */
  fills: PaperFill[];
  /** Balance after each close (time = exit time, ms), starting with the opening balance. */
  equity: { time: number; balance: number }[];
  start: number;
  balance: number;
  pnl: number;
  returnPct: number;
  fees: number;
  wins: number;
  losses: number;
  /** Largest fall from a previous high, in dollars and percent of that high. */
  maxDrawdown: number;
  maxDrawdownPct: number;
  best: PaperFill | null;
  worst: PaperFill | null;
  /** Most trades open at the same time (their risks add up). */
  maxOpen: number;
}

/** Replay closed trades (any order) in a paper account. Trades without fill or exit times are skipped. */
export function simulatePaper(trades: readonly PaperTradeOut[], s: PaperSettings): PaperResult {
  const usable = trades.filter(
    (t) => t.fillTime !== null && t.exitTime !== null && t.entryPrice !== t.stop,
  );
  // Events: an exit before a fill at the same moment, so a freed balance sizes the next trade.
  const events = usable.flatMap((t, i) => [
    { time: t.fillTime!, kind: 1, i },
    { time: t.exitTime!, kind: 0, i },
  ]);
  events.sort((a, b) => a.time - b.time || a.kind - b.kind || a.i - b.i);

  let balance = s.start;
  let open = 0;
  let maxOpen = 0;
  const risk = new Map<number, number>();
  const closed = new Set<number>();
  const fills: PaperFill[] = [];
  const equity = [
    { time: usable.length ? Math.min(...usable.map((t) => t.fillTime!)) : 0, balance },
  ];
  let peak = balance;
  let maxDrawdown = 0;
  let maxDrawdownPct = 0;
  for (const e of events) {
    const t = usable[e.i];
    if (e.kind === 1) {
      if (closed.has(e.i)) continue; // filled and closed in the same candle: done already
      const base = s.compound ? Math.max(0, balance) : s.start;
      risk.set(e.i, (base * s.riskPct) / 100);
      open++;
      maxOpen = Math.max(maxOpen, open);
      continue;
    }
    // A trade filled and stopped in the same candle shares one time for both events: size it
    // here if its fill has not been seen yet (exits sort first at equal times).
    let riskUsd = risk.get(e.i);
    if (riskUsd === undefined) {
      riskUsd = ((s.compound ? Math.max(0, balance) : s.start) * s.riskPct) / 100;
      maxOpen = Math.max(maxOpen, open + 1);
    } else {
      open--;
    }
    closed.add(e.i);
    const pnl = t.rNet * riskUsd;
    const fees = Math.max(0, (t.rGross - t.rNet) * riskUsd);
    balance += pnl;
    const qty = riskUsd / Math.abs(t.entryPrice - t.stop);
    fills.push({
      trade: t,
      riskUsd,
      qty,
      notional: qty * t.entryPrice,
      pnl,
      fees,
      balanceAfter: balance,
    });
    equity.push({ time: t.exitTime!, balance });
    peak = Math.max(peak, balance);
    const dd = peak - balance;
    if (dd > maxDrawdown) {
      maxDrawdown = dd;
      maxDrawdownPct = peak > 0 ? (dd / peak) * 100 : 0;
    }
  }
  const byPnl = [...fills].sort((a, b) => b.pnl - a.pnl);
  return {
    fills,
    equity,
    start: s.start,
    balance,
    pnl: balance - s.start,
    returnPct: s.start > 0 ? ((balance - s.start) / s.start) * 100 : 0,
    fees: fills.reduce((sum, f) => sum + f.fees, 0),
    wins: fills.filter((f) => f.pnl > 0).length,
    losses: fills.filter((f) => f.pnl <= 0).length,
    maxDrawdown,
    maxDrawdownPct,
    best: byPnl[0] ?? null,
    worst: byPnl[byPnl.length - 1] ?? null,
    maxOpen,
  };
}

/** Saved settings, validated (bad or missing values fall back to the defaults). */
export function parsePaperSettings(value: unknown): PaperSettings {
  const v = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  const start =
    typeof v.start === "number" && Number.isFinite(v.start) && v.start >= 100 && v.start <= 1e9
      ? v.start
      : DEFAULT_PAPER.start;
  const riskPct = RISK_CHOICES.find((c) => c === v.riskPct) ?? DEFAULT_PAPER.riskPct;
  const compound = typeof v.compound === "boolean" ? v.compound : DEFAULT_PAPER.compound;
  return { start, riskPct, compound };
}

/** "$10,234" / "−$1,250.50" (cents under $1 000). */
export function usd(v: number, signed = false): string {
  const a = Math.abs(v);
  const s = a.toLocaleString("en-US", {
    minimumFractionDigits: a < 1000 ? 2 : 0,
    maximumFractionDigits: a < 1000 ? 2 : 0,
  });
  const sign = v < 0 ? "−" : signed && v > 0 ? "+" : "";
  return `${sign}$${s}`;
}

/** Closed forward (live-recorded) trades in the shape the paper account replays. */
export function forwardToPaper(trades: readonly ForwardTradeOut[]): PaperTradeOut[] {
  return trades.flatMap((t) =>
    t.status === "closed" && t.entryPrice !== null && t.stop !== null
      ? [
          {
            symbol: t.symbol,
            pattern: t.pattern,
            direction: t.direction,
            location: t.location,
            time: t.time,
            entryPrice: t.entryPrice,
            stop: t.stop,
            exitPrice: t.exitPrice,
            reason: t.reason,
            rNet: t.rNet,
            rGross: t.rGross,
            fillTime: t.fillTime,
            exitTime: t.exitTime,
          },
        ]
      : [],
  );
}

export type PaperMode = "forward" | "replay";
export const PAPER_MODE_KEY = "paper:mode";
