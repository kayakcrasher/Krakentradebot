import { cashPnl, sizePosition, walkExit } from "./backtest.ts";
import { riskFromSignal } from "./risk.ts";
import type { Candle, Decision, Interval, Pair, PaperState, PaperTrade } from "./types.ts";
import { FEE_RATE, ROUND_TRIP_COST, SLIPPAGE, STARTING_EQUITY, TIME_STOP_BARS } from "./types.ts";

export function freshPaper(): PaperState {
  return { equity: STARTING_EQUITY, position: null, trades: [], lastSignalTime: null };
}

function markedEquity(trades: PaperTrade[]): number {
  return STARTING_EQUITY + trades.reduce((sum, trade) => sum + trade.pnl, 0);
}

function fillOpen(price: number, side: "long" | "short"): number {
  return price * (1 + (side === "long" ? SLIPPAGE : -SLIPPAGE));
}

function fillExit(price: number, side: "long" | "short"): number {
  return price * (1 + (side === "long" ? -SLIPPAGE : SLIPPAGE));
}

export function reducePaper(
  prev: PaperState,
  input: {
    pair: Pair;
    interval: Interval;
    closed: Candle[];
    live: Candle | null;
    decision: Decision;
  },
): PaperState {
  let position = prev.position;
  let trades = prev.trades;

  if (position && position.pair === input.pair && position.interval === input.interval) {
    const path = input.closed.filter((bar) => bar.time >= position!.openedAt);
    if (input.live && input.live.time >= position.openedAt && !path.some((bar) => bar.time === input.live!.time)) {
      path.push(input.live);
    }
    const stopDist = position.stopDist > 0 ? position.stopDist : Math.abs(position.entry - position.stop);
    const walked = walkExit(
      position.side,
      position.entry,
      path,
      stopDist,
      stopDist * 2,
      stopDist * 1.5,
      TIME_STOP_BARS,
      undefined,
      false,
      position.side === "long" ? position.entry * (1 + ROUND_TRIP_COST) : position.entry * (1 - ROUND_TRIP_COST),
    );
    if (walked.status === "closed" && walked.price !== undefined && walked.time !== undefined && walked.reason) {
      const { pnl } = cashPnl(position.side, position.entry, walked.price, position.qty);
      const closedTrade: PaperTrade = {
        pair: position.pair,
        side: position.side,
        pattern: position.pattern,
        entryTime: position.openedAt,
        exitTime: walked.time,
        entry: position.entry,
        exit: walked.price,
        pnl,
        r: position.riskUsd > 0 ? pnl / position.riskUsd : 0,
        reason: walked.reason,
        holdBars: walked.holdBars ?? 0,
      };
      const already = trades.some((trade) => trade.pair === closedTrade.pair && trade.entryTime === closedTrade.entryTime);
      trades = already ? trades : [...trades, closedTrade].slice(-40);
      position = null;
    } else {
      position = { ...position, stop: walked.stop };
    }
  }

  if (
    position &&
    position.pair === input.pair &&
    position.interval === input.interval &&
    input.decision.plan &&
    input.decision.plan.side !== position.side &&
    input.decision.barTime > position.signalTime &&
    input.decision.barTime !== prev.lastSignalTime &&
    input.live
  ) {
    const exit = fillExit(input.live.open, position.side);
    const { pnl } = cashPnl(position.side, position.entry, exit, position.qty);
    const closedTrade: PaperTrade = {
      pair: position.pair,
      side: position.side,
      pattern: position.pattern,
      entryTime: position.openedAt,
      exitTime: input.live.time,
      entry: position.entry,
      exit,
      pnl,
      r: position.riskUsd > 0 ? pnl / position.riskUsd : 0,
      reason: "flip",
      holdBars: 1,
    };
    const already = trades.some((trade) => trade.pair === closedTrade.pair && trade.entryTime === closedTrade.entryTime);
    trades = already ? trades : [...trades, closedTrade].slice(-40);
    position = null;
  }

  const equity = markedEquity(trades);
  const { decision } = input;
  const canEnter =
    !position &&
    decision.plan !== null &&
    decision.atr !== null &&
    decision.atr > 0 &&
    input.live !== null &&
    decision.barTime !== 0 &&
    decision.barTime !== prev.lastSignalTime;

  if (!canEnter || !decision.plan || !decision.atr || !input.live) {
    return { equity, position, trades, lastSignalTime: prev.lastSignalTime };
  }

  const drifted = Math.abs(input.live.close - input.live.open) > decision.atr * 0.85;
  let nextPosition = position;
  if (!drifted && equity > 0) {
    const fill = fillOpen(input.live.open, decision.plan.side);
    const risk = riskFromSignal(decision.plan.side, decision.plan.signalHigh, decision.plan.signalLow, fill, decision.atr);
    const sized = risk ? sizePosition(equity, fill, risk.stopDist) : null;
    if (risk && sized) {
      nextPosition = {
        pair: input.pair,
        interval: input.interval,
        side: decision.plan.side,
        pattern: decision.plan.pattern,
        entry: fill,
        qty: sized.qty,
        stop: decision.plan.side === "long" ? fill - risk.stopDist : fill + risk.stopDist,
        target: decision.plan.side === "long" ? fill + risk.targetDist : fill - risk.targetDist,
        atr: decision.atr,
        stopDist: risk.stopDist,
        riskUsd: sized.riskUsd,
        entryFee: fill * sized.qty * FEE_RATE,
        openedAt: input.live.time,
        signalTime: decision.barTime,
      };
    }
  }

  return {
    equity,
    position: nextPosition,
    trades,
    lastSignalTime: decision.barTime,
  };
}

export function unrealized(position: PaperState["position"], mark: number): number | null {
  if (!position || !(mark > 0)) return null;
  const { pnl } = cashPnl(position.side, position.entry, mark, position.qty);
  return pnl;
}
