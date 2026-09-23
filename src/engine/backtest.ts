import { finite, type Indicators } from "./indicators.ts";
import { decideAt, prepare } from "./decide.ts";
import { riskFromSignal } from "./risk.ts";
import type {
  BacktestResult,
  Candle,
  Comparison,
  EquityPoint,
  ExitReason,
  Side,
  Stats,
  Trade,
} from "./types.ts";
import {
  BASELINE_STOP_PCT,
  BASELINE_TARGET_PCT,
  FEE_RATE,
  MAX_NOTIONAL_PCT,
  RISK_PCT,
  SLIPPAGE,
  STARTING_EQUITY,
  TIME_STOP_BARS,
} from "./types.ts";

interface Plan {
  side: Side;
  pattern: string;
  stopDist: number;
  targetDist: number;
  breakevenDist: number;
  breakevenStop?: number;
}

export interface WalkResult {
  status: "open" | "closed";
  stop: number;
  price?: number;
  time?: number;
  reason?: ExitReason;
  holdBars?: number;
  exitIndex?: number;
}

function slip(price: number, side: Side, kind: "entry" | "exit"): number {
  const worse = side === "long" ? (kind === "entry" ? 1 : -1) : kind === "entry" ? -1 : 1;
  return price * (1 + worse * SLIPPAGE);
}

export function cashPnl(side: Side, entry: number, exit: number, qty: number): { pnl: number; fees: number } {
  const fees = (entry + exit) * qty * FEE_RATE;
  const gross = side === "long" ? (exit - entry) * qty : (entry - exit) * qty;
  return { pnl: gross - fees, fees };
}

export function sizePosition(equity: number, fill: number, stopDist: number): { qty: number; riskUsd: number } | null {
  if (!(equity > 0) || !(fill > 0) || !(stopDist > 0)) return null;
  let riskUsd = equity * RISK_PCT;
  let qty = riskUsd / stopDist;
  const cap = equity * MAX_NOTIONAL_PCT;
  if (qty * fill > cap) {
    qty = cap / fill;
    riskUsd = qty * stopDist;
  }
  if (qty * fill < 10) return null;
  return { qty, riskUsd };
}

export function walkExit(
  side: Side,
  entry: number,
  path: Candle[],
  stopDist: number,
  targetDist: number,
  breakevenDist: number,
  maxBars: number,
  flipAt?: (index: number) => boolean,
  flatAtEnd = false,
  breakevenStop?: number,
): WalkResult {
  let stop = side === "long" ? entry - stopDist : entry + stopDist;
  const target = side === "long" ? entry + targetDist : entry - targetDist;
  let armed = false;
  const limit = Math.min(path.length, Math.max(maxBars, 1));

  const closeAt = (index: number, raw: number, reason: ExitReason): WalkResult => {
    const bar = path[index];
    return {
      status: "closed",
      stop,
      price: slip(raw, side, "exit"),
      time: bar?.time ?? 0,
      reason,
      holdBars: index,
      exitIndex: index,
    };
  };

  for (let j = 0; j < limit; j++) {
    const bar = path[j];
    if (!bar) break;
    if (side === "long") {
      if (bar.low <= stop) return closeAt(j, stop, "stop");
      if (bar.high >= target) return closeAt(j, target, "target");
    } else {
      if (bar.high >= stop) return closeAt(j, stop, "stop");
      if (bar.low <= target) return closeAt(j, target, "target");
    }
    if (!armed) {
      const reached = side === "long" ? bar.high >= entry + breakevenDist : bar.low <= entry - breakevenDist;
      if (reached) {
        armed = true;
        const locked = breakevenStop ?? entry;
        stop = side === "long" ? Math.max(stop, locked) : Math.min(stop, locked);
      }
    }
    if (flipAt?.(j)) {
      const next = path[j + 1];
      if (next) return closeAt(j + 1, next.open, "flip");
    }
    if (j === maxBars - 1) return closeAt(j, bar.close, "time");
  }

  if (flatAtEnd && path.length > 0) {
    const last = Math.min(path.length, limit) - 1;
    const bar = path[last];
    if (bar) return closeAt(last, bar.close, "window");
  }
  return { status: "open", stop };
}

function baselinePlan(bars: Candle[], ind: Indicators, i: number): Plan | null {
  const bar = bars[i];
  const rsi = ind.rsi[i];
  const prevRsi = ind.rsi[i - 1];
  const fast = ind.smaFast[i];
  const slow = ind.smaSlow[i];
  const prevFast = ind.smaFast[i - 1];
  const prevSlow = ind.smaSlow[i - 1];
  if (!bar || !finite(rsi) || !finite(prevRsi) || !finite(fast) || !finite(slow) || !finite(prevFast) || !finite(prevSlow)) {
    return null;
  }
  const bullish = prevFast <= prevSlow && fast > slow && rsi < 70;
  const bearish = prevFast >= prevSlow && fast < slow;
  const rsiCross = prevRsi <= 70 && rsi > 70;
  const stopDist = bar.close * BASELINE_STOP_PCT;
  const targetDist = bar.close * BASELINE_TARGET_PCT;
  if (bullish) return { side: "long", pattern: "SMA cross", stopDist, targetDist, breakevenDist: stopDist };
  if (bearish || rsiCross) {
    return {
      side: "short",
      pattern: rsiCross && !bearish ? "RSI 70 cross" : "SMA cross",
      stopDist,
      targetDist,
      breakevenDist: stopDist,
    };
  }
  return null;
}

function aegisPlan(
  bars: Candle[],
  ind: Indicators,
  htf: Array<"up" | "down" | "flat">,
  i: number,
  skipped: { n: number },
): Plan | null {
  const decision = decideAt(bars, ind, htf, i, null);
  const entryBar = bars[i + 1];
  const atr = decision.atr;
  if (!entryBar || !decision.side || !atr) {
    if (decision.patterns.length > 0) skipped.n += 1;
    return null;
  }
  const fill = slip(entryBar.open, decision.side, "entry");
  const risk = riskFromSignal(decision.side, entryBar ? bars[i]!.high : 0, bars[i]!.low, fill, atr);
  if (!risk || !decision.plan) {
    if (decision.patterns.length > 0) skipped.n += 1;
    return null;
  }
  return {
    side: decision.side,
    pattern: decision.plan.pattern,
    stopDist: risk.stopDist,
    targetDist: risk.targetDist,
    breakevenDist: risk.breakevenDist,
    breakevenStop: risk.breakevenStop,
  };
}

function emptyStats(skipped = 0): Stats {
  return {
    trades: 0,
    wins: 0,
    losses: 0,
    winRate: 0,
    netPnl: 0,
    returnPct: 0,
    profitFactor: 0,
    expectancy: 0,
    avgR: 0,
    maxDrawdownPct: 0,
    fees: 0,
    avgHoldBars: 0,
    skippedPatterns: skipped,
  };
}

function summarize(trades: Trade[], equity: EquityPoint[], fees: number, skipped: number, startEquity: number): Stats {
  if (trades.length === 0) {
    const stats = emptyStats(skipped);
    stats.fees = fees;
    stats.maxDrawdownPct = drawdown(equity);
    return stats;
  }
  let wins = 0;
  let grossWin = 0;
  let grossLoss = 0;
  let net = 0;
  let rSum = 0;
  let hold = 0;
  for (const trade of trades) {
    net += trade.pnl;
    rSum += trade.r;
    hold += trade.holdBars;
    if (trade.pnl >= 0) {
      wins += 1;
      grossWin += trade.pnl;
    } else grossLoss += -trade.pnl;
  }
  const losses = trades.length - wins;
  return {
    trades: trades.length,
    wins,
    losses,
    winRate: (wins / trades.length) * 100,
    netPnl: net,
    returnPct: startEquity > 0 ? (net / startEquity) * 100 : 0,
    profitFactor: grossLoss === 0 ? 0 : grossWin / grossLoss,
    expectancy: rSum / trades.length,
    avgR: rSum / trades.length,
    maxDrawdownPct: drawdown(equity),
    fees,
    avgHoldBars: hold / trades.length,
    skippedPatterns: skipped,
  };
}

function drawdown(equity: EquityPoint[]): number {
  let peak = equity[0]?.equity ?? STARTING_EQUITY;
  let maxDd = 0;
  for (const point of equity) {
    if (point.equity > peak) peak = point.equity;
    const dd = peak > 0 ? ((peak - point.equity) / peak) * 100 : 0;
    if (dd > maxDd) maxDd = dd;
  }
  return maxDd;
}

export function runBacktest(bars: Candle[], mode: "aegis" | "baseline", factor: number): BacktestResult {
  if (bars.length < 40) {
    const equity = [{ time: bars[0]?.time ?? 0, equity: STARTING_EQUITY }];
    const stats = emptyStats();
    return { trades: [], equity, stats, holdout: stats };
  }
  const { ind, htf } = prepare(bars, factor);
  const trades: Trade[] = [];
  const equity: EquityPoint[] = [{ time: bars[0]!.time, equity: STARTING_EQUITY }];
  let cash = STARTING_EQUITY;
  let fees = 0;
  const skipped = { n: 0 };
  const holdoutStart = bars[Math.floor(bars.length * 0.75)]?.time ?? Number.POSITIVE_INFINITY;
  let i = 210;

  while (i < bars.length - 2 && cash > 0) {
    const plan = mode === "aegis" ? aegisPlan(bars, ind, htf, i, skipped) : baselinePlan(bars, ind, i);
    if (!plan) {
      i += 1;
      continue;
    }
    const entryBar = bars[i + 1];
    if (!entryBar) break;
    const fill = slip(entryBar.open, plan.side, "entry");
    const sized = sizePosition(cash, fill, plan.stopDist);
    if (!sized) {
      i += 1;
      continue;
    }
    const path = bars.slice(i + 1);
    const walked = walkExit(
      plan.side,
      fill,
      path,
      plan.stopDist,
      plan.targetDist,
      plan.breakevenDist,
      TIME_STOP_BARS,
      mode === "baseline"
        ? (index) => {
            if (index === 0) return false;
            const next = baselinePlan(bars, ind, i + 1 + index);
            return Boolean(next && next.side !== plan.side);
          }
        : (index) => {
            if (index === 0) return false;
            const signal = i + 1 + index;
            if (signal >= bars.length - 1) return false;
            const decision = decideAt(bars, ind, htf, signal, null);
            return decision.side !== null && decision.side !== plan.side && decision.plan !== null;
          },
      true,
      plan.breakevenStop,
    );
    if (walked.status !== "closed" || walked.price === undefined || walked.time === undefined || walked.reason === undefined) {
      break;
    }
    const { pnl, fees: tradeFees } = cashPnl(plan.side, fill, walked.price, sized.qty);
    fees += tradeFees;
    cash += pnl;
    const trade: Trade = {
      side: plan.side,
      pattern: plan.pattern,
      entryTime: entryBar.time,
      exitTime: walked.time,
      entry: fill,
      exit: walked.price,
      pnl,
      r: sized.riskUsd > 0 ? pnl / sized.riskUsd : 0,
      reason: walked.reason,
      holdBars: walked.holdBars ?? 0,
    };
    trades.push(trade);
    equity.push({ time: walked.time, equity: cash });
    i = i + 1 + (walked.exitIndex ?? 0) + 1;
  }

  const stats = summarize(trades, equity, fees, skipped.n, STARTING_EQUITY);
  const holdTrades = trades.filter((trade) => trade.entryTime >= holdoutStart);
  const holdFees = 0;
  const holdEquity: EquityPoint[] = [{ time: holdoutStart, equity: STARTING_EQUITY }];
  let holdCash = STARTING_EQUITY;
  for (const trade of holdTrades) {
    holdCash += trade.pnl;
    holdEquity.push({ time: trade.exitTime, equity: holdCash });
  }
  const holdout = summarize(holdTrades, holdEquity, holdFees, 0, STARTING_EQUITY);
  return { trades, equity, stats, holdout };
}

export function compare(bars: Candle[], factor: number): Comparison {
  return {
    aegis: runBacktest(bars, "aegis", factor),
    baseline: runBacktest(bars, "baseline", factor),
    from: bars[0]?.time ?? 0,
    to: bars[bars.length - 1]?.time ?? 0,
    bars: bars.length,
  };
}
