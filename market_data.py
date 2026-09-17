"""Market Data Module for fetching live candlestick data from Kraken API."""

import requests
import pandas as pd
from config import KRAKEN_BASE_URL, DEFAULT_PAIR, DEFAULT_INTERVAL


class KrakenDataFetcher:

  def __init__(self, base_url: str = KRAKEN_BASE_URL):
    self.base_url = base_url

  def fetch_ohlc(
      self, pair: str = DEFAULT_PAIR, interval: int = DEFAULT_INTERVAL
  ) -> pd.DataFrame:
    """Fetches public historical OHLCV candlestick data from Kraken.

    :param pair: Asset pair symbol (e.g., 'XBTUSD', 'ETHUSD')
    :param interval: Timeframe in minutes
    :return: Pandas DataFrame containing price candles
    """
    endpoint = f"{self.base_url}/OHLC"
    params = {"pair": pair, "interval": interval}

    response = requests.get(endpoint, params=params, timeout=10)
    data = response.json()

    if data.get("error"):
      raise RuntimeError(f"Kraken API Error: {data['error']}")

    result = data["result"]
    pair_key = [k for k in result.keys() if k != "last"][0]
    raw_candles = result[pair_key]

    df = pd.DataFrame(
        raw_candles,
        columns=[
            "time",
            "open",
            "high",
            "low",
            "close",
            "vwap",
            "volume",
            "count",
        ],
    )

    df["time"] = pd.to_datetime(df["time"], unit="s")
    float_cols = ["open", "high", "low", "close", "vwap", "volume"]
    df[float_cols] = df[float_cols].astype(float)

    return df[["time", "open", "high", "low", "close", "volume"]]


if __name__ == "__main__":
  fetcher = KrakenDataFetcher()
  df = fetcher.fetch_ohlc()
  print("--- Live Market Data ---")
  print(df.tail())
