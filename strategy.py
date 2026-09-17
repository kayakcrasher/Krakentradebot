"""Strategy Engine evaluating technicals, depth liquidity, and liquidation zones."""

import typing
import pandas as pd


class TradingStrategy:

  def __init__(self, rsi_period: int = 14, sma_fast: int = 10, sma_slow: int = 30):
    self.rsi_period = rsi_period
    self.sma_fast = sma_fast
    self.sma_slow = sma_slow

  def calculate_indicators(self, df: pd.DataFrame) -> pd.DataFrame:
    """Calculates SMA and RSI indicators on OHLCV data."""
    df = df.copy()

    # Simple Moving Averages
    df["sma_fast"] = df["close"].rolling(window=self.sma_fast).mean()
    df["sma_slow"] = df["close"].rolling(window=self.sma_slow).mean()

    # Relative Strength Index (RSI)
    delta = df["close"].diff()
    gain = (delta.where(delta > 0, 0)).rolling(window=self.rsi_period).mean()
    loss = (-delta.where(delta < 0, 0)).rolling(window=self.rsi_period).mean()

    rs = gain / loss
    df["rsi"] = 100 - (100 / (1 + rs))

    return df

  def generate_signal(
      self,
      df: pd.DataFrame,
      liquidity_metrics: typing.Dict[str, float],
      clusters: typing.Dict[str, typing.List],
  ) -> str:
    """Evaluates indicators, liquidity, and liquidation walls to output a signal."""
    if len(df) < self.sma_slow:
      return "HOLD"

    df_ind = self.calculate_indicators(df)
    latest = df_ind.iloc[-1]
    prev = df_ind.iloc[-2]

    # Signal Logic: Moving Average Crossover + RSI Guard
    bullish_cross = (prev["sma_fast"] <= prev["sma_slow"]) and (
        latest["sma_fast"] > latest["sma_slow"]
    )
    bearish_cross = (prev["sma_fast"] >= prev["sma_slow"]) and (
        latest["sma_fast"] < latest["sma_slow"]
    )

    # 1. Liquidity Guard: Ensure order book is balanced before entering
    if liquidity_metrics.get("liquidity_ratio", 1.0) < 0.7:
      return "HOLD"

    # 2. Liquidation Overhead Wall Guard: Do not buy directly below massive sell wall
    current_price = latest["close"]
    resistance_walls = clusters.get("resistance_walls", [])
    for wall in resistance_walls[:3]:
      if 0 < (wall["price"] - current_price) / current_price < 0.005:
        # Near a massive sell wall/liquidation resistance zone
        return "HOLD"

    if bullish_cross and latest["rsi"] < 70:
      return "BUY"
    elif bearish_cross or latest["rsi"] > 70:
      return "SELL"

    return "HOLD"


if __name__ == "__main__":
  import numpy as np

  # Mock validation test
  data = {"close": np.linspace(100, 110, 40)}
  mock_df = pd.DataFrame(data)
  strategy = TradingStrategy()
  sig = strategy.generate_signal(
      mock_df,
      {"liquidity_ratio": 1.2},
      {"resistance_walls": [], "support_walls": []},
  )
  print(f"Test Signal Output: {sig}")
