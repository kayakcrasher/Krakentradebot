import type { Side } from "./types.ts";
import { ROUND_TRIP_COST } from "./types.ts";

export const MIN_NOISE_ATR = 2;
export const MAX_NOISE_ATR = 4.5;
export const TARGET_R = 2;
export const BREAKEVEN_R = 1.5;

export interface RiskLevels {
  stopDist: number;
  targetDist: number;
  breakevenDist: number;
  breakevenStop: number;
}

export function feesEatTheStop(price: number, atr: number): boolean {
  return !(atr > 0) || MIN_NOISE_ATR * atr < price * ROUND_TRIP_COST * 4;
}

export function riskFromSignal(
  side: Side,
  signalHigh: number,
  signalLow: number,
  entry: number,
  atr: number,
): RiskLevels | null {
  if (!(atr > 0) || !(entry > 0) || !(signalHigh > 0) || !(signalLow > 0)) return null;
  const minDist = Math.max(MIN_NOISE_ATR * atr, entry * ROUND_TRIP_COST * 4);
  const maxDist = MAX_NOISE_ATR * atr;
  if (minDist > maxDist) return null;
  if (side === "long" && entry <= signalLow) return null;
  if (side === "short" && entry >= signalHigh) return null;
  const invalid = side === "long" ? entry - (signalLow - atr * 0.2) : signalHigh + atr * 0.2 - entry;
  const stopDist = Math.max(minDist, invalid);
  if (stopDist > maxDist) return null;
  return {
    stopDist,
    targetDist: stopDist * TARGET_R,
    breakevenDist: stopDist * BREAKEVEN_R,
    breakevenStop: side === "long" ? entry * (1 + ROUND_TRIP_COST) : entry * (1 - ROUND_TRIP_COST),
  };
}
