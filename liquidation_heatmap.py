"""Liquidation & Order Book Volume Wall Cluster Detector."""

import typing
import pandas as pd
from market_depth import OrderBookAnalyzer


class LiquidationHeatmapDetector:

  def __init__(self, depth_analyzer: OrderBookAnalyzer = None):
    self.depth_analyzer = depth_analyzer or OrderBookAnalyzer()

  def detect_volume_clusters(
      self, pair: str = "XBTUSD", threshold_multiplier: float = 2.5
  ) -> typing.Dict[str, typing.List[typing.Dict]]:
    """Identifies high-density price levels (order walls/liquidation zones).

    :param threshold_multiplier: Multiplier over average volume to flag a wall
    """
    book = self.depth_analyzer.fetch_order_book(pair=pair, count=100)

    bids = pd.DataFrame(book["bids"], columns=["price", "volume", "timestamp"])[
        ["price", "volume"]
    ].astype(float)
    asks = pd.DataFrame(book["asks"], columns=["price", "volume", "timestamp"])[
        ["price", "volume"]
    ].astype(float)

    avg_bid_vol = bids["volume"].mean()
    avg_ask_vol = asks["volume"].mean()

    # Find significant bid walls (buy/liquidation support)
    bid_walls = bids[bids["volume"] >= (avg_bid_vol * threshold_multiplier)]
    # Find significant ask walls (sell/liquidation resistance)
    ask_walls = asks[asks["volume"] >= (avg_ask_vol * threshold_multiplier)]

    return {
        "support_walls": bid_walls.to_dict(orient="records"),
        "resistance_walls": ask_walls.to_dict(orient="records"),
    }


if __name__ == "__main__":
  heatmap = LiquidationHeatmapDetector()
  clusters = heatmap.detect_volume_clusters()
  print("--- Significant Support Liquidation Clusters ---")
  print(clusters["support_walls"][:3])
  print("--- Significant Resistance Liquidation Clusters ---")
  print(clusters["resistance_walls"][:3])
