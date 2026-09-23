# Lugus

Paper engine for BTC/USD and ETH/USD on Kraken. No exchange keys. No live orders.

The old flat Python scripts are gone. What is here is the rulebook: patterns, a fee-aware stop, a replay against the original SMA book, and a paper position that can flip from long to short.

## Run the tests

Node 22 or newer. Nothing to install.

```bash
npm test
```

## Layout

```
src/engine/
  types.ts        pairs, candles, costs
  indicators.ts   EMA, ATR, ADX, RSI, MACD, swings
  patterns.ts     engulfing, pin, pullback, squeeze, rejection, structure
  risk.ts         stop beyond the signal bar, never inside the fee
  decide.ts       score, regime, higher-timeframe veto
  backtest.ts     Lugus vs the original SMA book
  paper.ts        one position, including a flip to the other side
  kraken.ts       public OHLC and the order book
  engine.test.ts
```

## Candles

| Button | Source |
| --- | --- |
| 1m, 5m | Kraken public OHLC, latest 720 bars |
| 10m | Two 5-minute bars. Kraken has no 10-minute feed |
| 1h, 4h, 1D | Kraken public OHLC |

A fast chart often stands aside. The stop has to clear the 0.26% taker fee each way. That is a result, not a missed click.
