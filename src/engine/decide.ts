import { computeIndicators, finite, type Indicators } from "./indicators.ts";
import { detectPatterns } from "./patterns.ts";
import { feesEatTheStop, riskFromSignal } from "./risk.ts";
import type { BookSnapshot, Candle, Decision, Interval, OrderPlan, PatternHit, Regime, Side, SideScore } from "./types.ts";
import { SCORE_THRESHOLD } from "./types.ts";

export function htfFactor(interval: Interval): number {
  if (interval === 1) return 5;
  if (interval === 5) return 6;
  if (interval === 10) return 3;
  if (interval === 15) return 4;
  if (interval === 60) return 4;
  if (interval === 240) return 6;
  return 5;
}

export function computeHtfBias(bars: Candle[], factor: number): Array<"up" | "down" | "flat"> {
  const out = new Array<"up" | "down" | "flat">(bars.length).fill("flat");
  if (factor < 2 || bars.length === 0) return out;
  const closes: number[] = [];
  let bias: "up" | "down" | "flat" = "flat";
  for (let i = 0; i < bars.length; i++) {
    if ((i + 1) % factor === 0) {
      closes.push(bars[i]!.close);
      if (closes.length >= 50) {
        const fast = emaLast(closes, 20);
        const slow = emaLast(closes, 50);
        if (fast !== null && slow !== null) {
          if (fast > slow) bias = "up";
          else if (fast < slow) bias = "down";
          else bias = "flat";
        }
      }
    }
    out[i] = bias;
  }
  return out;
}

function emaLast(values: number[], period: number): number | null {
  if (values.length < period) return null;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i] ?? 0;
  let prev = sum / period;
  const k = 2 / (period + 1);
  for (let i = period; i < values.length; i++) {
    const v = values[i] ?? prev;
    prev = v * k + prev * (1 - k);
  }
  return prev;
}

export function regimeAt(bars: Candle[], ind: Indicators, i: number): Regime {
  const bar = bars[i];
  const adx = ind.adx[i];
  const ema50 = ind.ema50[i];
  const plus = ind.plusDI[i];
  const minus = ind.minusDI[i];
  if (!bar || !finite(adx) || !finite(ema50) || !finite(plus) || !finite(minus)) return "range";
  if (adx >= 20 && plus > minus && bar.close > ema50) return "up";
  if (adx >= 20 && minus > plus && bar.close < ema50) return "down";
  return "range";
}

function emptyScore(): SideScore {
  return { score: 0, reasons: [], blocks: [] };
}

function allowed(pattern: PatternHit, regime: Regime): boolean {
  if (regime === "range") return pattern.style === "fade";
  if (regime === "up") return pattern.side === "long" && pattern.style === "trend";
  return pattern.side === "short" && pattern.style === "trend";
}

function scoreSide(
  side: Side,
  bars: Candle[],
  ind: Indicators,
  i: number,
  regime: Regime,
  patterns: PatternHit[],
  htf: "up" | "down" | "flat",
  book: BookSnapshot | null,
): SideScore {
  const bar = bars[i];
  const result = emptyScore();
  if (!bar) {
    result.blocks.push("missing bar");
    return result;
  }

  const matching = patterns.filter((pattern) => pattern.side === side && allowed(pattern, regime));
  matching.sort((a, b) => b.weight - a.weight);
  const best = matching[0];
  const atr = ind.atr[i];
  const rsi = ind.rsi[i];
  const hist = ind.macdHist[i];
  const prevHist = ind.macdHist[i - 1];
  const ema20 = ind.ema20[i];
  const volAvg = ind.volSma[i];

  if (!finite(atr) || atr <= 0) {
    result.blocks.push("volatility is too low to pay the spread");
  } else if (feesEatTheStop(bar.close, atr)) {
    result.blocks.push("ATR is too small to clear Kraken's taker fee");
  }

  if (!best) {
    result.blocks.push(regime === "range" ? "no range pattern" : "no trend pattern in this regime");
  }

  if (side === "long" && htf === "down") result.blocks.push("higher timeframe is down");
  if (side === "short" && htf === "up") result.blocks.push("higher timeframe is up");

  if (finite(rsi)) {
    if (side === "long" && rsi > 74) result.blocks.push("RSI is already stretched");
    if (side === "short" && rsi < 26) result.blocks.push("RSI is already stretched");
  }

  const momentum =
    finite(hist) && finite(prevHist) && (side === "long" ? hist > 0 && hist > prevHist : hist < 0 && hist < prevHist);
  const volume = finite(volAvg) && volAvg > 0 && bar.volume >= volAvg;
  if (best && !momentum && !volume) result.blocks.push("no momentum and no extra volume");

  if (book && book.spreadPct > 0.12) result.blocks.push("spread is too wide");
  if (book && side === "long") {
    const wall = book.askWalls.find((level) => level.usd >= 200_000 && level.price > book.mid && (level.price - book.mid) / book.mid < 0.0025);
    if (wall) result.blocks.push("ask wall is sitting just overhead");
    if (book.ratio < 0.55) result.blocks.push("order book is heavy on the offer");
  }
  if (book && side === "short") {
    const wall = book.bidWalls.find((level) => level.usd >= 200_000 && level.price < book.mid && (book.mid - level.price) / book.mid < 0.0025);
    if (wall) result.blocks.push("bid wall is sitting just underneath");
    if (book.ratio > 1.8) result.blocks.push("order book is heavy on the bid");
  }

  if (regime === "up" && side === "long") {
    result.score += 24;
    result.reasons.push("Uptrend regime");
  } else if (regime === "down" && side === "short") {
    result.score += 24;
    result.reasons.push("Downtrend regime");
  } else if (regime === "range" && best?.style === "fade") {
    result.score += 24;
    result.reasons.push("Range regime fits a fade");
  }

  if (best) {
    result.score += best.weight;
    result.reasons.push(best.name);
    if (matching.length > 1) {
      result.score += 4;
      result.reasons.push("Second pattern agrees");
    }
  }
  if (momentum) {
    result.score += 14;
    result.reasons.push("MACD histogram is turning with the trade");
  }
  if (finite(rsi) && ((side === "long" && rsi >= 45 && rsi <= 68) || (side === "short" && rsi <= 55 && rsi >= 32))) {
    result.score += 8;
    result.reasons.push("RSI is not chased");
  }
  if (finite(ema20) && ((side === "long" && bar.close > ema20) || (side === "short" && bar.close < ema20))) {
    result.score += 8;
    result.reasons.push(side === "long" ? "Price is above the 20-bar average" : "Price is below the 20-bar average");
  }
  if (volume) {
    result.score += 6;
    result.reasons.push("Volume is above its average");
  }
  if ((side === "long" && htf === "up") || (side === "short" && htf === "down")) {
    result.score += 6;
    result.reasons.push("Higher timeframe agrees");
  }

  return result;
}

function illustrative(side: Side, bar: Candle, atr: number, pattern: string): OrderPlan | null {
  const risk = riskFromSignal(side, bar.high, bar.low, bar.close, atr);
  if (!risk) return null;
  return {
    side,
    pattern,
    entry: bar.close,
    stop: side === "long" ? bar.close - risk.stopDist : bar.close + risk.stopDist,
    target: side === "long" ? bar.close + risk.targetDist : bar.close - risk.targetDist,
    atr,
    signalHigh: bar.high,
    signalLow: bar.low,
  };
}

export function decideAt(
  bars: Candle[],
  ind: Indicators,
  htf: Array<"up" | "down" | "flat">,
  i: number,
  book: BookSnapshot | null,
): Decision {
  const bar = bars[i];
  const regime = regimeAt(bars, ind, i);
  const patterns = bar ? detectPatterns(bars, ind, i) : [];
  const bias = htf[i] ?? "flat";
  const long = scoreSide("long", bars, ind, i, regime, patterns, bias, book);
  const short = scoreSide("short", bars, ind, i, regime, patterns, bias, book);
  const adx = ind.adx[i];
  const rsi = ind.rsi[i];
  const atr = ind.atr[i];

  const base = {
    index: i,
    barTime: bar?.time ?? 0,
    regime,
    patterns,
    long,
    short,
    adx: finite(adx) ? adx : null,
    rsi: finite(rsi) ? rsi : null,
    atr: finite(atr) ? atr : null,
  };

  if (!bar || !finite(atr)) {
    return { ...base, side: null, score: 0, headline: "Stand aside — indicators are not ready", plan: null };
  }

  const longOk = long.blocks.length === 0 && long.score >= SCORE_THRESHOLD;
  const shortOk = short.blocks.length === 0 && short.score >= SCORE_THRESHOLD;
  let side: Side | null = null;
  if (longOk && shortOk) {
    if (long.score >= short.score + 8) side = "long";
    else if (short.score >= long.score + 8) side = "short";
  } else if (longOk) side = "long";
  else if (shortOk) side = "short";

  if (!side) {
    const blocked = [long, short].find((score) => score.blocks.length > 0 && score.reasons.length > 0);
    const reason = blocked?.blocks[0];
    return {
      ...base,
      side: null,
      score: Math.max(long.score, short.score),
      headline: reason ? `Stand aside — ${reason}` : "Stand aside — no setup cleared the filters",
      plan: null,
    };
  }

  const chosen = side === "long" ? long : short;
  const best = patterns
    .filter((pattern) => pattern.side === side && allowed(pattern, regime))
    .sort((a, b) => b.weight - a.weight)[0];
  const plan = illustrative(side, bar, atr, best?.name ?? "Confluence");
  if (!plan) {
    return {
      ...base,
      side: null,
      score: chosen.score,
      headline: "Stand aside — the stop would be inside the noise or the fee",
      plan: null,
    };
  }
  return {
    ...base,
    side,
    score: chosen.score,
    headline: `${side === "long" ? "Long" : "Short"} · ${plan.pattern} · score ${Math.round(chosen.score)}`,
    plan,
  };
}

export function prepare(bars: Candle[], factor: number): { ind: Indicators; htf: Array<"up" | "down" | "flat"> } {
  return { ind: computeIndicators(bars), htf: computeHtfBias(bars, factor) };
}

export function latestDecision(bars: Candle[], book: BookSnapshot | null, factor: number): Decision {
  if (bars.length < 30) {
    return {
      index: -1,
      barTime: 0,
      regime: "range",
      patterns: [],
      long: emptyScore(),
      short: emptyScore(),
      side: null,
      score: 0,
      headline: "Stand aside — not enough history yet",
      plan: null,
      adx: null,
      rsi: null,
      atr: null,
    };
  }
  const { ind, htf } = prepare(bars, factor);
  return decideAt(bars, ind, htf, bars.length - 1, book);
}
