import assert from "node:assert/strict";
import test from "node:test";
import { runBacktest, walkExit } from "./backtest.ts";
import { freshPaper, reducePaper } from "./paper.ts";
import type { Candle, Decision } from "./types.ts";
import { STARTING_EQUITY } from "./types.ts";

function candles(count: number, drift: number): Candle[] {
  const out: Candle[] = [];
  let price = 100;
  for (let i = 0; i < count; i++) {
    const wave = Math.sin(i / 7) * 0.4;
    const open = price;
    price = Math.max(1, price * (1 + drift) + wave);
    const close = price;
    const high = Math.max(open, close) + 0.3;
    const low = Math.min(open, close) - 0.3;
    out.push({ time: 1_700_000_000 + i * 3600, open, high, low, close, volume: 10 + (i % 5) });
  }
  return out;
}

test("stop is filled before the target on the same bar", () => {
  const path: Candle[] = [
    { time: 1, open: 100, high: 110, low: 90, close: 105, volume: 1 },
  ];
  const walked = walkExit("long", 100, path, 5, 8, 4, 10, undefined, true);
  assert.equal(walked.status, "closed");
  assert.equal(walked.reason, "stop");
  assert.ok((walked.price ?? 0) < 95);
});

test("backtest stays finite on a drift and a flat tape", () => {
  for (const drift of [0, 0.002, -0.0015]) {
    const result = runBacktest(candles(420, drift), "aegis", 4);
    const baseline = runBacktest(candles(420, drift), "baseline", 4);
    for (const book of [result, baseline]) {
      assert.ok(Number.isFinite(book.stats.netPnl));
      assert.ok(Number.isFinite(book.stats.expectancy));
      assert.ok(book.stats.winRate >= 0 && book.stats.winRate <= 100);
      const end = book.equity[book.equity.length - 1]?.equity ?? STARTING_EQUITY;
      const net = book.trades.reduce((sum, trade) => sum + trade.pnl, 0);
      assert.ok(Math.abs(end - (STARTING_EQUITY + net)) < 0.01);
      for (const trade of book.trades) {
        assert.ok(Number.isFinite(trade.pnl));
        assert.ok(Number.isFinite(trade.r));
        assert.ok(trade.exitTime >= trade.entryTime);
      }
    }
  }
});

test("paper entry is not repeated for the same signal", () => {
  const decision: Decision = {
    index: 10,
    barTime: 50,
    regime: "up",
    patterns: [],
    long: { score: 70, reasons: [], blocks: [] },
    short: { score: 10, reasons: [], blocks: [] },
    side: "long",
    score: 70,
    headline: "Long",
    plan: {
      side: "long",
      pattern: "EMA pullback",
      entry: 100,
      stop: 96,
      target: 108,
      atr: 2,
      signalHigh: 101,
      signalLow: 98,
    },
    adx: 25,
    rsi: 55,
    atr: 2,
  };
  const live = { time: 60, open: 100, high: 101, low: 99.8, close: 100.4, volume: 3 };
  const once = reducePaper(freshPaper(), {
    pair: "XBTUSD",
    interval: 60,
    closed: [],
    live,
    decision,
  });
  assert.ok(once.position);
  const twice = reducePaper(once, {
    pair: "XBTUSD",
    interval: 60,
    closed: [],
    live,
    decision,
  });
  assert.equal(twice.trades.length, once.trades.length);
  assert.equal(twice.position?.entry, once.position?.entry);
  assert.equal(twice.lastSignalTime, 50);
});

test("an opposite signal flips the paper position", () => {
  const long: Decision = {
    index: 1,
    barTime: 50,
    regime: "up",
    patterns: [],
    long: { score: 70, reasons: [], blocks: [] },
    short: { score: 10, reasons: [], blocks: [] },
    side: "long",
    score: 70,
    headline: "Long",
    plan: {
      side: "long",
      pattern: "EMA pullback",
      entry: 100,
      stop: 96,
      target: 108,
      atr: 2,
      signalHigh: 101,
      signalLow: 98,
    },
    adx: 25,
    rsi: 55,
    atr: 2,
  };
  const live = { time: 60, open: 100, high: 101, low: 99.8, close: 100.4, volume: 3 };
  const opened = reducePaper(freshPaper(), {
    pair: "XBTUSD",
    interval: 1,
    closed: [],
    live,
    decision: long,
  });
  assert.equal(opened.position?.side, "long");
  const short: Decision = {
    ...long,
    barTime: 120,
    side: "short",
    plan: long.plan ? { ...long.plan, side: "short", signalHigh: 101, signalLow: 97 } : null,
  };
  const flipped = reducePaper(opened, {
    pair: "XBTUSD",
    interval: 1,
    closed: [],
    live: { ...live, time: 180, open: 101 },
    decision: short,
  });
  assert.equal(flipped.trades[0]?.reason, "flip");
  assert.equal(flipped.position?.side, "short");
});
