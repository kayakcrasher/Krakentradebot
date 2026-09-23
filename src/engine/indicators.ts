import type { Candle } from "./types.ts";

export interface Indicators {
  ema20: number[];
  ema50: number[];
  ema200: number[];
  smaFast: number[];
  smaSlow: number[];
  atr: number[];
  rsi: number[];
  adx: number[];
  plusDI: number[];
  minusDI: number[];
  macdHist: number[];
  bbMid: number[];
  bbUpper: number[];
  bbLower: number[];
  bbWidth: number[];
  volSma: number[];
  swingHighs: number[];
  swingLows: number[];
}

export function ema(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(Number.NaN);
  const k = 2 / (period + 1);
  let prev = Number.NaN;
  let seedSum = 0;
  let seedCount = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i] ?? Number.NaN;
    if (Number.isNaN(v)) continue;
    if (Number.isNaN(prev)) {
      seedSum += v;
      seedCount += 1;
      if (seedCount === period) {
        prev = seedSum / period;
        out[i] = prev;
      }
      continue;
    }
    prev = v * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

export function sma(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(Number.NaN);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i] ?? 0;
    if (i >= period) sum -= values[i - period] ?? 0;
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

function wilderFrom(values: number[], period: number, start: number): number[] {
  const out = new Array<number>(values.length).fill(Number.NaN);
  if (values.length <= start + period) return out;
  let sum = 0;
  for (let i = start; i < start + period; i++) sum += values[i] ?? 0;
  let prev = sum / period;
  const at = start + period - 1;
  out[at] = prev;
  for (let i = at + 1; i < values.length; i++) {
    prev = (prev * (period - 1) + (values[i] ?? 0)) / period;
    out[i] = prev;
  }
  return out;
}

export function computeIndicators(bars: Candle[]): Indicators {
  const closes = bars.map((b) => b.close);
  const volumes = bars.map((b) => b.volume);
  const n = bars.length;
  const tr = new Array<number>(n).fill(0);
  const plusDM = new Array<number>(n).fill(0);
  const minusDM = new Array<number>(n).fill(0);
  for (let i = 1; i < n; i++) {
    const cur = bars[i];
    const prev = bars[i - 1];
    if (!cur || !prev) continue;
    const up = cur.high - prev.high;
    const down = prev.low - cur.low;
    plusDM[i] = up > down && up > 0 ? up : 0;
    minusDM[i] = down > up && down > 0 ? down : 0;
    tr[i] = Math.max(cur.high - cur.low, Math.abs(cur.high - prev.close), Math.abs(cur.low - prev.close));
  }

  const atr = wilderFrom(tr, 14, 1);
  const smPlus = wilderFrom(plusDM, 14, 1);
  const smMinus = wilderFrom(minusDM, 14, 1);
  const plusDI = new Array<number>(n).fill(Number.NaN);
  const minusDI = new Array<number>(n).fill(Number.NaN);
  const dx = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    const a = atr[i] ?? Number.NaN;
    if (Number.isNaN(a) || a === 0) continue;
    plusDI[i] = (100 * (smPlus[i] ?? 0)) / a;
    minusDI[i] = (100 * (smMinus[i] ?? 0)) / a;
    const sum = plusDI[i] + minusDI[i];
    dx[i] = sum === 0 ? 0 : (100 * Math.abs(plusDI[i] - minusDI[i])) / sum;
  }
  const adx = wilderFrom(dx, 14, 15);
  for (let i = 0; i < 28 && i < n; i++) adx[i] = Number.NaN;

  const rsi = new Array<number>(n).fill(Number.NaN);
  if (n > 14) {
    let gain = 0;
    let loss = 0;
    for (let i = 1; i <= 14; i++) {
      const d = closes[i]! - closes[i - 1]!;
      if (d >= 0) gain += d;
      else loss -= d;
    }
    let avgG = gain / 14;
    let avgL = loss / 14;
    rsi[14] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
    for (let i = 15; i < n; i++) {
      const d = closes[i]! - closes[i - 1]!;
      avgG = (avgG * 13 + (d > 0 ? d : 0)) / 14;
      avgL = (avgL * 13 + (d < 0 ? -d : 0)) / 14;
      rsi[i] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
    }
  }

  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const macdLine = closes.map((_, i) => {
    const a = ema12[i] ?? Number.NaN;
    const b = ema26[i] ?? Number.NaN;
    return Number.isNaN(a) || Number.isNaN(b) ? Number.NaN : a - b;
  });
  const signal = ema(macdLine, 9);
  const macdHist = macdLine.map((v, i) => {
    const s = signal[i] ?? Number.NaN;
    return Number.isNaN(v) || Number.isNaN(s) ? Number.NaN : v - s;
  });

  const bbMid = sma(closes, 20);
  const bbUpper = new Array<number>(n).fill(Number.NaN);
  const bbLower = new Array<number>(n).fill(Number.NaN);
  const bbWidth = new Array<number>(n).fill(Number.NaN);
  for (let i = 19; i < n; i++) {
    const mid = bbMid[i] ?? Number.NaN;
    if (Number.isNaN(mid)) continue;
    let variance = 0;
    for (let j = i - 19; j <= i; j++) {
      const d = closes[j]! - mid;
      variance += d * d;
    }
    const sd = Math.sqrt(variance / 20);
    bbUpper[i] = mid + 2 * sd;
    bbLower[i] = mid - 2 * sd;
    bbWidth[i] = mid === 0 ? 0 : (bbUpper[i]! - bbLower[i]!) / mid;
  }

  const swingHighs: number[] = [];
  const swingLows: number[] = [];
  const left = 3;
  for (let i = left; i < n - left; i++) {
    let isHigh = true;
    let isLow = true;
    const bar = bars[i];
    if (!bar) continue;
    for (let j = i - left; j <= i + left; j++) {
      if (j === i) continue;
      const other = bars[j];
      if (!other) continue;
      if (other.high >= bar.high) isHigh = false;
      if (other.low <= bar.low) isLow = false;
    }
    if (isHigh) swingHighs.push(i);
    if (isLow) swingLows.push(i);
  }

  return {
    ema20: ema(closes, 20),
    ema50: ema(closes, 50),
    ema200: ema(closes, 200),
    smaFast: sma(closes, 10),
    smaSlow: sma(closes, 30),
    atr,
    rsi,
    adx,
    plusDI,
    minusDI,
    macdHist,
    bbMid,
    bbUpper,
    bbLower,
    bbWidth,
    volSma: sma(volumes, 20),
    swingHighs,
    swingLows,
  };
}

export function finite(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
