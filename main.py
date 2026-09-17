"""Main Runner Script for the Risk-Averse Kraken Trading Bot."""

import time
from config import DEFAULT_INTERVAL, DEFAULT_PAIR
from liquidation_heatmap import LiquidationHeatmapDetector
from market_data import KrakenDataFetcher
from market_depth import OrderBookAnalyzer
from risk_management import RiskManager
from strategy import TradingStrategy


def run_bot_cycle(
    fetcher, depth_analyzer, heatmap, strategy, risk_mgr, simulated_balance=10000.0
):
  print("\n==========================================")
  print(f"Running Bot Analysis Cycle for {DEFAULT_PAIR}...")

  # 1. Fetch Market Data & Liquidity
  df = fetcher.fetch_ohlc(pair=DEFAULT_PAIR, interval=DEFAULT_INTERVAL)
  liquidity_metrics = depth_analyzer.analyze_liquidity(pair=DEFAULT_PAIR)
  clusters = heatmap.detect_volume_clusters(pair=DEFAULT_PAIR)

  current_price = df["close"].iloc[-1]
  print(f"Current Price: ${current_price:,.2f}")
  print(
      f"Spread: {liquidity_metrics['spread_pct']}% | Liquidity Ratio:"
      f" {liquidity_metrics['liquidity_ratio']}"
  )

  # 2. Strategy Signal Generation
  raw_signal = strategy.generate_signal(df, liquidity_metrics, clusters)
  print(f"Raw Strategy Signal: {raw_signal}")

  # 3. Risk Management Approval
  risk_decision = risk_mgr.validate_trade_execution(
      signal=raw_signal,
      liquidity_metrics=liquidity_metrics,
      account_balance_usd=simulated_balance,
  )

  if risk_decision["approved"]:
    print(f"🟢 TRADE APPROVED: {risk_decision['signal']}")
    print(f"   Entry Price: ${risk_decision['entry_price']:,.2f}")
    print(f"   Position Size: ${risk_decision['position_size_usd']}")
    print(f"   Stop-Loss: ${risk_decision['stop_loss']:,.2f}")
    print(f"   Take-Profit: ${risk_decision['take_profit']:,.2f}")
  else:
    print(f"🟡 NO TRADE EXECUTED: {risk_decision['reason']}")


if __name__ == "__main__":
  fetcher = KrakenDataFetcher()
  depth_analyzer = OrderBookAnalyzer()
  heatmap = LiquidationHeatmapDetector(depth_analyzer)
  strategy = TradingStrategy()
  risk_mgr = RiskManager()

  # Run paper trading loop every 30 seconds
  try:
    while True:
      run_bot_cycle(fetcher, depth_analyzer, heatmap, strategy, risk_mgr)
      time.sleep(30)
  except KeyboardInterrupt:
    print("\nBot stopped by user.")
