import { finite, type Indicators } from "./indicators.ts";
import type { Candle, PatternHit, Side } from "./types.ts";

const LAG = 3;

function body(bar: Candle): number {
  return Math.abs(bar.close - bar.open);
}

function range(bar: Candle): number {
  return bar.high - bar.low;
}

function upperWick(bar: Candle): number {
  return bar.high - Math.max(bar.open, bar.close);
}

function lowerWick(bar: Candle): number {
  return Math.min(bar.open, bar.close) - bar.low;
}

function confirmed(indices: number[], i: number): number[] {
  const out: number[] = [];
  for (const index of indices) {
    if (index + LAG <= i) out.push(index);
  }
  return out;
}

function hit(
  name: string,
  side: Side,
  weight: number,
  detail: string,
  style: PatternHit["style"],
): PatternHit {
  return { name, side, weight, detail, style };
}

export function detectPatterns(bars: Candle[], ind: Indicators, i: number): PatternHit[] {
  if (i < 3 || i >= bars.length) return [];
  const cur = bars[i];
  const prev = bars[i - 1];
  const mother = bars[i - 2];
  if (!cur || !prev || !mother) return [];

  const out: PatternHit[] = [];
  const atr = ind.atr[i];
  const volAvg = ind.volSma[i];
  const volOk = finite(volAvg) && volAvg > 0 ? cur.volume >= volAvg * 1.15 : false;
  const r = range(cur);
  const b = body(cur);

  const prevBodyTop = Math.max(prev.open, prev.close);
  const prevBodyBot = Math.min(prev.open, prev.close);
  const curBodyTop = Math.max(cur.open, cur.close);
  const curBodyBot = Math.min(cur.open, cur.close);
  const bullEngulf =
    prev.close < prev.open &&
    cur.close > cur.open &&
    curBodyBot <= prevBodyBot &&
    curBodyTop >= prevBodyTop &&
    b > body(prev);
  const bearEngulf =
    prev.close > prev.open &&
    cur.close < cur.open &&
    curBodyBot <= prevBodyBot &&
    curBodyTop >= prevBodyTop &&
    b > body(prev);
  if (bullEngulf) {
    out.push(
      hit(
        "Bullish engulfing",
        "long",
        volOk ? 24 : 16,
        volOk ? "Current body swallowed the prior bar on rising volume." : "Current body swallowed the prior bar.",
        "trend",
      ),
    );
  }
  if (bearEngulf) {
    out.push(
      hit(
        "Bearish engulfing",
        "short",
        volOk ? 24 : 16,
        volOk ? "Current body swallowed the prior bar on rising volume." : "Current body swallowed the prior bar.",
        "trend",
      ),
    );
  }

  if (finite(atr) && atr > 0 && r > atr * 0.5 && b > 0) {
    const lower = lowerWick(cur);
    const upper = upperWick(cur);
    const bbLower = ind.bbLower[i];
    const bbUpper = ind.bbUpper[i];
    const lows = confirmed(ind.swingLows, i);
    const highs = confirmed(ind.swingHighs, i);
    const lastLow = lows.length ? bars[lows[lows.length - 1]!] : undefined;
    const lastHigh = highs.length ? bars[highs[highs.length - 1]!] : undefined;
    const nearSupport =
      (finite(bbLower) && cur.low <= bbLower + atr * 0.15) ||
      (lastLow ? Math.abs(cur.low - lastLow.low) <= atr * 0.45 : false);
    const nearResistance =
      (finite(bbUpper) && cur.high >= bbUpper - atr * 0.15) ||
      (lastHigh ? Math.abs(cur.high - lastHigh.high) <= atr * 0.45 : false);

    if (lower >= b * 2 && lower / r >= 0.62 && upper / r <= 0.18 && cur.close >= cur.low + r * 0.66 && nearSupport) {
      out.push(hit("Bullish pin bar", "long", 22, "Long lower wick rejected a nearby low.", "fade"));
    }
    if (upper >= b * 2 && upper / r >= 0.62 && lower / r <= 0.18 && cur.close <= cur.high - r * 0.66 && nearResistance) {
      out.push(hit("Bearish pin bar", "short", 22, "Long upper wick rejected a nearby high.", "fade"));
    }
  }

  const motherRange = range(mother);
  const inside =
    prev.high < mother.high &&
    prev.low > mother.low &&
    finite(atr) &&
    motherRange > atr * 0.7 &&
    range(prev) < motherRange * 0.75;
  if (inside && cur.close > mother.high && cur.close > cur.open) {
    out.push(hit("Inside-bar break", "long", 20, "Price left a tight bar through the mother-bar high.", "trend"));
  }
  if (inside && cur.close < mother.low && cur.close < cur.open) {
    out.push(hit("Inside-bar break", "short", 20, "Price left a tight bar through the mother-bar low.", "trend"));
  }

  const ema20 = ind.ema20[i];
  const ema50 = ind.ema50[i];
  const ema200 = ind.ema200[i];
  const prevEma20 = ind.ema20[i - 1];
  const adx = ind.adx[i];
  const plus = ind.plusDI[i];
  const minus = ind.minusDI[i];
  const rsi = ind.rsi[i];
  if (finite(ema20) && finite(ema50) && finite(ema200) && finite(prevEma20) && finite(adx) && finite(plus) && finite(minus) && finite(rsi)) {
    const upStack = ema20 > ema50 && ema50 > ema200 && cur.close > ema50 && adx >= 18 && plus > minus;
    const downStack = ema20 < ema50 && ema50 < ema200 && cur.close < ema50 && adx >= 18 && minus > plus;
    const dipped = prev.low <= prevEma20 * 1.002 && prev.low >= ema50;
    const popped = prev.high >= prevEma20 * 0.998 && prev.high <= ema50;
    if (upStack && dipped && cur.close > ema20 && cur.close > cur.open && rsi >= 42 && rsi <= 64) {
      out.push(hit("EMA pullback", "long", 26, "Uptrend dipped into the 20-bar average and closed back above it.", "trend"));
    }
    if (downStack && popped && cur.close < ema20 && cur.close < cur.open && rsi <= 58 && rsi >= 36) {
      out.push(hit("EMA pullback", "short", 26, "Downtrend rallied into the 20-bar average and closed back below it.", "trend"));
    }
  }

  const width = ind.bbWidth[i];
  const prevWidth = ind.bbWidth[i - 1];
  const upperBand = ind.bbUpper[i];
  const lowerBand = ind.bbLower[i];
  const hist = ind.macdHist[i];
  const prevHist = ind.macdHist[i - 1];
  if (finite(width) && finite(prevWidth) && finite(upperBand) && finite(lowerBand) && finite(hist) && finite(prevHist)) {
    const start = Math.max(20, i - 60);
    const sample: number[] = [];
    for (let k = start; k < i; k++) {
      const w = ind.bbWidth[k];
      if (finite(w)) sample.push(w);
    }
    if (sample.length >= 20) {
      const sorted = [...sample].sort((a, b) => a - b);
      const rank = sorted[Math.floor(sorted.length * 0.25)] ?? sorted[0]!;
      const squeezed = prevWidth <= rank && width > prevWidth;
      if (squeezed && cur.close > upperBand && hist > 0 && hist > prevHist) {
        out.push(hit("Squeeze break", "long", 22, "Bands were compressed, then price closed out the top.", "trend"));
      }
      if (squeezed && cur.close < lowerBand && hist < 0 && hist < prevHist) {
        out.push(hit("Squeeze break", "short", 22, "Bands were compressed, then price closed out the bottom.", "trend"));
      }
    }
  }

  if (finite(adx) && adx < 20 && finite(lowerBand) && finite(upperBand) && finite(volAvg)) {
    const climax = cur.volume >= volAvg * 1.3;
    if (climax && prev.low <= lowerBand && cur.close > lowerBand && cur.close > cur.open) {
      out.push(hit("Band rejection", "long", 22, "A volume spike under the lower band closed back inside.", "fade"));
    }
    if (climax && prev.high >= upperBand && cur.close < upperBand && cur.close < cur.open) {
      out.push(hit("Band rejection", "short", 22, "A volume spike over the upper band closed back inside.", "fade"));
    }
  }

  const swingHighs = confirmed(ind.swingHighs, i).slice(-2);
  const swingLows = confirmed(ind.swingLows, i).slice(-2);
  if (swingHighs.length === 2 && swingLows.length === 2 && finite(atr)) {
    const h0 = bars[swingHighs[0]!];
    const h1 = bars[swingHighs[1]!];
    const l0 = bars[swingLows[0]!];
    const l1 = bars[swingLows[1]!];
    const freshHigh = h1 && i - swingHighs[1]! <= 40;
    const freshLow = l1 && i - swingLows[1]! <= 40;
    if (h0 && h1 && l0 && l1 && freshHigh && h1.high > h0.high && l1.low > l0.low && cur.close > h1.high) {
      out.push(hit("Swing structure", "long", 18, "Higher highs and higher lows, then a close through the last high.", "trend"));
    }
    if (h0 && h1 && l0 && l1 && freshLow && h1.high < h0.high && l1.low < l0.low && cur.close < l1.low) {
      out.push(hit("Swing structure", "short", 18, "Lower highs and lower lows, then a close through the last low.", "trend"));
    }
  }

  return out;
}
