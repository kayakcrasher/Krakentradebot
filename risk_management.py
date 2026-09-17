"""Risk Management Module for strict safety and capital preservation."""

import typing
from config import MAX_RISK_PER_TRADE, STOP_LOSS_PCT, TAKE_PROFIT_PCT


class RiskManager:

  def __init__(
      self,
      max_risk_pct: float = MAX_RISK_PER_TRADE,
      max_spread_pct: float = 0.15,
      min_liquidity_ratio: float = 0.8,
  ):
    self.max_risk_pct = max_risk_pct
    self.max_spread_pct = max_spread_pct  # Max 0.15% spread allowed
    self.min_liquidity_ratio = min_liquidity_ratio

  def validate_trade_execution(
      self,
      signal: str,
      liquidity_metrics: typing.Dict[str, float],
      account_balance_usd: float,
  ) -> typing.Dict[str, typing.Union[bool, str, float]]:
    """Evaluates if a signal passes strict risk checks."""

    if signal == "HOLD":
      return {"approved": False, "reason": "No actionable signal."}

    # Guard 1: Bid-Ask Spread Check
    if liquidity_metrics["spread_pct"] > self.max_spread_pct:
      return {
          "approved": False,
          "reason": (
              f"Spread too wide ({liquidity_metrics['spread_pct']}% >"
              f" {self.max_spread_pct}%)"
          ),
      }

    # Guard 2: Order Book Imbalance Check for Buys
    if (
        signal == "BUY"
        and liquidity_metrics["liquidity_ratio"] < self.min_liquidity_ratio
    ):
      return {
          "approved": False,
          "reason": (
              f"Insufficient buy liquidity support (Ratio:"
              f" {liquidity_metrics['liquidity_ratio']})"
          ),
      }

    # Calculate Position Size and Risk Boundaries
    risk_amount_usd = account_balance_usd * self.max_risk_pct
    entry_price = (
        liquidity_metrics["best_ask"]
        if signal == "BUY"
        else liquidity_metrics["best_bid"]
    )

    stop_loss = (
        entry_price * (1 - STOP_LOSS_PCT)
        if signal == "BUY"
        else entry_price * (1 + STOP_LOSS_PCT)
    )
    take_profit = (
        entry_price * (1 + TAKE_PROFIT_PCT)
        if signal == "BUY"
        else entry_price * (1 - TAKE_PROFIT_PCT)
    )

    return {
        "approved": True,
        "signal": signal,
        "entry_price": entry_price,
        "position_size_usd": round(risk_amount_usd, 2),
        "stop_loss": round(stop_loss, 2),
        "take_profit": round(take_profit, 2),
        "reason": "Trade passed all risk guards.",
    }


if __name__ == "__main__":
  rm = RiskManager()
  # Mock test
  mock_liquidity = {
      "best_bid": 65000.0,
      "best_ask": 65010.0,
      "spread_pct": 0.015,
      "liquidity_ratio": 1.35,
  }
  decision = rm.validate_trade_execution("BUY", mock_liquidity, 10000.0)
  print("--- Risk Management Decision ---")
  print(decision)
