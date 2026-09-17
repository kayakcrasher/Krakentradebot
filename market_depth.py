"""Market Depth and Order Book Liquidity Module for Kraken."""

import typing
import pandas as pd
import requests
from config import DEFAULT_PAIR, KRAKEN_BASE_URL


class OrderBookAnalyzer:

  def __init__(self, base_url: str = KRAKEN_BASE_URL):
    self.base_url = base_url

  def fetch_order_book(
      self, pair: str = DEFAULT_PAIR, count: int = 100
  ) -> typing.Dict:
    """Fetches Level 2 Order Book snapshot from Kraken REST API."""
    endpoint = f"{self.base_url}/Depth"
    params = {"pair": pair, "count": count}

    response = requests.get(endpoint, params=params, timeout=10)
    data = response.json()

    if data.get("error"):
      raise RuntimeError(f"Kraken Depth API Error: {data['error']}")

    result = data["result"]
    pair_key = [k for k in result.keys()][0]
    return result[pair_key]

  def analyze_liquidity(
      self, pair: str = DEFAULT_PAIR, depth_count: int = 50
  ) -> typing.Dict[str, float]:
    """Calculates order book bid/ask metrics, spread, and liquidity ratio."""
    book = self.fetch_order_book(pair=pair, count=depth_count)

    bids = pd.DataFrame(book["bids"], columns=["price", "volume", "timestamp"])
    asks = pd.DataFrame(book["asks"], columns=["price", "volume", "timestamp"])

    bids[["price", "volume"]] = bids[["price", "volume"]].astype(float)
    asks[["price", "volume"]] = asks[["price", "volume"]].astype(float)

    best_bid = bids["price"].max()
    best_ask = asks["price"].min()
    bid_ask_spread = best_ask - best_bid
    spread_pct = (bid_ask_spread / best_ask) * 100

    total_bid_liquidity = (bids["price"] * bids["volume"]).sum()
    total_ask_liquidity = (asks["price"] * asks["volume"]).sum()

    # Imbalance > 1.0 indicates stronger buy side support
    liquidity_ratio = (
        total_bid_liquidity / total_ask_liquidity
        if total_ask_liquidity > 0
        else 1.0
    )

    return {
        "best_bid": best_bid,
        "best_ask": best_ask,
        "spread_pct": round(spread_pct, 4),
        "total_bid_usd": round(total_bid_liquidity, 2),
        "total_ask_usd": round(total_ask_liquidity, 2),
        "liquidity_ratio": round(liquidity_ratio, 2),
    }


if __name__ == "__main__":
  analyzer = OrderBookAnalyzer()
  metrics = analyzer.analyze_liquidity()
  print("--- Live Liquidity Analysis ---")
  for k, v in metrics.items():
    print(f"{k}: {v}")
