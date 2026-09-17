"""Global Configuration Parameters for Kraken Trading Bot."""

# Exchange Settings
KRAKEN_BASE_URL = "https://api.kraken.com/0/public"

# Trading Settings
DEFAULT_PAIR = "XBTUSD"  # Kraken BTC/USD symbol
DEFAULT_INTERVAL = 1  # Timeframe in minutes (1, 5, 15, 30, 60, 240, 1440)

# Strategy Parameters
SMA_FAST = 10  # Short-term simple moving average window
SMA_SLOW = 30  # Long-term simple moving average window
RSI_PERIOD = 14  # Relative Strength Index period
RSI_OVERSOLD = 30  # Buy signal threshold
RSI_OVERBOUGHT = 70  # Sell signal threshold

# Risk Management
MAX_RISK_PER_TRADE = 0.02  # Risk max 2% of capital per trade
STOP_LOSS_PCT = 0.015  # 1.5% stop-loss
TAKE_PROFIT_PCT = 0.03  # 3.0% take-profit
