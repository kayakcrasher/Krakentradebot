import type { BookLevel, BookSnapshot, Candle, Interval, Pair } from "./types.ts";

const BASE = "https://api.kraken.com/0/public";

interface CacheEntry {
  at: number;
  closed: Candle[];
  live: Candle | null;
  book: BookSnapshot;
}

const cache = new Map<string, CacheEntry>();

export interface MarketBook {
  pair: Pair;
  interval: Interval;
  fetchedAt: number;
  closed: Candle[];
  live: Candle | null;
  book: BookSnapshot;
}

function asNumber(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : Number.NaN;
}

function parseCandles(rows: unknown[]): Candle[] {
  const out: Candle[] = [];
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 7) continue;
    const candle: Candle = {
      time: asNumber(row[0]),
      open: asNumber(row[1]),
      high: asNumber(row[2]),
      low: asNumber(row[3]),
      close: asNumber(row[4]),
      volume: asNumber(row[6]),
    };
    if ([candle.time, candle.open, candle.high, candle.low, candle.close, candle.volume].every(Number.isFinite)) {
      out.push(candle);
    }
  }
  return out;
}

async function getJson(url: string): Promise<Record<string, unknown>> {
  const response = await fetch(url, { signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error(`Kraken returned ${response.status}`);
  const body = (await response.json()) as { error?: string[]; result?: Record<string, unknown> };
  if (body.error && body.error.length > 0) throw new Error(body.error.join(", "));
  if (!body.result) throw new Error("Kraken returned an empty result");
  return body.result;
}

async function fetchOhlc(pair: Pair, interval: Interval): Promise<Candle[]> {
  if (interval === 10) {
    const fives = await fetchNative(pair, 5);
    return aggregate(fives, 600);
  }
  return fetchNative(pair, interval);
}

async function fetchNative(pair: Pair, interval: number): Promise<Candle[]> {
  const result = await getJson(`${BASE}/OHLC?pair=${pair}&interval=${interval}`);
  const key = Object.keys(result).find((name) => name !== "last");
  const rows = key && Array.isArray(result[key]) ? (result[key] as unknown[]) : [];
  return parseCandles(rows).sort((a, b) => a.time - b.time);
}

function aggregate(candles: Candle[], seconds: number): Candle[] {
  const buckets = new Map<number, Candle>();
  for (const bar of candles) {
    const time = Math.floor(bar.time / seconds) * seconds;
    const existing = buckets.get(time);
    if (!existing) {
      buckets.set(time, { ...bar, time });
      continue;
    }
    existing.high = Math.max(existing.high, bar.high);
    existing.low = Math.min(existing.low, bar.low);
    existing.close = bar.close;
    existing.volume += bar.volume;
  }
  return [...buckets.values()].sort((a, b) => a.time - b.time);
}

function levels(raw: unknown, count: number): BookLevel[] {
  if (!Array.isArray(raw)) return [];
  const out: BookLevel[] = [];
  for (const row of raw.slice(0, count)) {
    if (!Array.isArray(row)) continue;
    const price = asNumber(row[0]);
    const volume = asNumber(row[1]);
    if (!Number.isFinite(price) || !Number.isFinite(volume)) continue;
    out.push({ price, volume, usd: price * volume });
  }
  return out;
}

function walls(rows: BookLevel[]): BookLevel[] {
  if (rows.length === 0) return [];
  const avg = rows.reduce((sum, row) => sum + row.volume, 0) / rows.length;
  return rows
    .filter((row) => row.volume >= avg * 2.5)
    .sort((a, b) => b.usd - a.usd)
    .slice(0, 4);
}

async function fetchBook(pair: Pair): Promise<BookSnapshot> {
  const result = await getJson(`${BASE}/Depth?pair=${pair}&count=40`);
  const key = Object.keys(result)[0];
  const book = key && typeof result[key] === "object" && result[key] !== null ? (result[key] as Record<string, unknown>) : {};
  const bids = levels(book.bids, 12).sort((a, b) => b.price - a.price);
  const asks = levels(book.asks, 12).sort((a, b) => a.price - b.price);
  const bestBid = bids[0]?.price ?? 0;
  const bestAsk = asks[0]?.price ?? 0;
  const bidUsd = bids.reduce((sum, row) => sum + row.usd, 0);
  const askUsd = asks.reduce((sum, row) => sum + row.usd, 0);
  const mid = bestBid && bestAsk ? (bestBid + bestAsk) / 2 : bestBid || bestAsk;
  return {
    bids,
    asks,
    bestBid,
    bestAsk,
    mid,
    spreadPct: bestAsk > 0 ? ((bestAsk - bestBid) / bestAsk) * 100 : 0,
    bidUsd,
    askUsd,
    ratio: askUsd > 0 ? bidUsd / askUsd : 1,
    bidWalls: walls(bids),
    askWalls: walls(asks),
  };
}

function splitLive(candles: Candle[], interval: Interval): { closed: Candle[]; live: Candle | null } {
  const last = candles[candles.length - 1];
  if (!last) return { closed: [], live: null };
  const now = Math.floor(Date.now() / 1000);
  if (now < last.time + interval * 60) {
    return { closed: candles.slice(0, -1), live: last };
  }
  return { closed: candles, live: null };
}

export async function loadMarket(pair: Pair, interval: Interval): Promise<MarketBook> {
  const key = `${pair}:${interval}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 20_000) {
    return { pair, interval, fetchedAt: hit.at, closed: hit.closed, live: hit.live, book: hit.book };
  }
  const [candles, book] = await Promise.all([fetchOhlc(pair, interval), fetchBook(pair)]);
  const { closed, live } = splitLive(candles, interval);
  const entry = { at: Date.now(), closed, live, book };
  cache.set(key, entry);
  return { pair, interval, fetchedAt: entry.at, closed, live, book };
}
