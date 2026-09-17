"""Market Data Module for fetching live candlestick data from Kraken API."""

import pandas as pd
import requests
from config import DEFAULT_INTERVAL, DEFAULT_PAIR, KRAKEN_BASE_URL


class KrakenDataFetcher:

  def __init__(self, base_url: str = KRAKEN_BASE_URL):
    self.base_url = base_url

  def fetch_ohlc(
      self, pair: str = DEFAULT_PAIR, interval: int = DEFAULT_INTERVAL
  ) -> pd.DataFrame:
    """Fetches public historical OHLCV candlestick data from Kraken."""
    endpoint = f"{self.base_url}/OHLC"
    params = {"pair": pair, "interval": interval}

    response = requests.get(endpoint, params=params, timeout=10)
    response.raise_for_status()
    data = response.json()

    if data.get("error"):
      raise RuntimeError(f"Kraken API Error: {data['error']}")

    result = data["result"]

    # Filter out metadata keys like 'last' to safely extract pair candle data
    pair_keys = [k for k in result.keys() if k != "last"]
    if not pair_keys:
      raise KeyError("No market data returned for pair.")

    raw_candles = result[pair_keys[0]]

    # Parse expected fields safely
    formatted_candles = []
    for candle in raw_candles:
      formatted_candles.append({
          "time": candle[0],
          "open": float(candle[1]),
          "high": float(candle[2]),
          "low": float(candle[3]),
          "close": float(candle[4]),
          "volume": float(candle[6]),
      })

    df = pd.DataFrame(formatted_candles)
    df["time"] = pd.to_datetime(df["time"], unit="s")

    return df[["time", "open", "high", "low", "close", "volume"]]


if __name__ == "__main__":
  fetcher = KrakenDataFetcher()
  df = fetcher.fetch_ohlc()
  print("--- Live Market Data ---")
  print(df.tail(10))
