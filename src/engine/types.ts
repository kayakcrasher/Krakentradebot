export type Pair = "XBTUSD" | "ETHUSD";
export type Interval = 1 | 5 | 10 | 15 | 60 | 240 | 1440;
export type Side = "long" | "short";
export type Regime = "up" | "down" | "range";
export type ExitReason = "stop" | "target" | "time" | "flip" | "window";
export type PatternStyle = "trend" | "fade";

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface BookLevel {
  price: number;
  volume: number;
  usd: number;
}

export interface BookSnapshot {
  bids: BookLevel[];
  asks: BookLevel[];
  bestBid: number;
  bestAsk: number;
  mid: number;
  spreadPct: number;
  bidUsd: number;
  askUsd: number;
  ratio: number;
  bidWalls: BookLevel[];
  askWalls: BookLevel[];
}

export interface PatternHit {
  name: string;
  side: Side;
  weight: number;
  detail: string;
  style: PatternStyle;
}

export interface SideScore {
  score: number;
  reasons: string[];
  blocks: string[];
}

export interface OrderPlan {
  side: Side;
  pattern: string;
  entry: number;
  stop: number;
  target: number;
  atr: number;
  signalHigh: number;
  signalLow: number;
}

export interface Decision {
  index: number;
  barTime: number;
  regime: Regime;
  patterns: PatternHit[];
  long: SideScore;
  short: SideScore;
  side: Side | null;
  score: number;
  headline: string;
  plan: OrderPlan | null;
  adx: number | null;
  rsi: number | null;
  atr: number | null;
}

export interface Trade {
  side: Side;
  pattern: string;
  entryTime: number;
  exitTime: number;
  entry: number;
  exit: number;
  pnl: number;
  r: number;
  reason: ExitReason;
  holdBars: number;
}

export interface EquityPoint {
  time: number;
  equity: number;
}

export interface Stats {
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  netPnl: number;
  returnPct: number;
  profitFactor: number;
  expectancy: number;
  avgR: number;
  maxDrawdownPct: number;
  fees: number;
  avgHoldBars: number;
  skippedPatterns: number;
}

export interface BacktestResult {
  trades: Trade[];
  equity: EquityPoint[];
  stats: Stats;
  holdout: Stats;
}

export interface Comparison {
  aegis: BacktestResult;
  baseline: BacktestResult;
  from: number;
  to: number;
  bars: number;
}

export interface PaperPosition {
  pair: Pair;
  interval: Interval;
  side: Side;
  pattern: string;
  entry: number;
  qty: number;
  stop: number;
  target: number;
  atr: number;
  stopDist: number;
  riskUsd: number;
  entryFee: number;
  openedAt: number;
  signalTime: number;
}

export interface PaperTrade extends Trade {
  pair: Pair;
}

export interface PaperState {
  equity: number;
  position: PaperPosition | null;
  trades: PaperTrade[];
  lastSignalTime: number | null;
}

export const STARTING_EQUITY = 10_000;
export const SCORE_THRESHOLD = 60;
export const FEE_RATE = 0.0026;
export const SLIPPAGE = 0.0004;
export const RISK_PCT = 0.01;
export const MAX_NOTIONAL_PCT = 0.35;
export const STOP_ATR = 1.5;
export const TARGET_ATR = 3.2;
export const BREAKEVEN_ATR = 1.6;
export const TIME_STOP_BARS = 36;
export const MIN_ATR_PCT = 0.003;
export const ROUND_TRIP_COST = (FEE_RATE + SLIPPAGE) * 2;
export const BASELINE_STOP_PCT = 0.015;
export const BASELINE_TARGET_PCT = 0.03;
