"""Private API Execution Module for Order Routing and Balance Checks on Kraken."""

import base64
import hashlib
import hmac
import time
import urllib.parse
import requests
from credentials import CredentialsManager


class KrakenPrivateExecution:

  def __init__(self, credentials: CredentialsManager):
    self.creds = credentials
    self.base_url = "https://api.kraken.com"

  def _generate_signature(
      self, urlpath: str, data: dict, secret: str
  ) -> str:
    """Generates HMAC-SHA512 signature required for Kraken private API endpoints."""
    postdata = urllib.parse.urlencode(data)
    encoded = (str(data["nonce"]) + postdata).encode()
    message = urlpath.encode() + hashlib.sha256(encoded).digest()

    mac = hmac.new(base64.b64decode(secret), message, hashlib.sha512)
    sigdigest = base64.b64encode(mac.digest())
    return sigdigest.decode()

  def _private_request(self, endpoint: str, data: dict = None) -> dict:
    """Executes an authenticated private API POST request."""
    if self.creds.paper_trading:
      raise PermissionError("Private requests are disabled in Paper Trading mode.")

    if data is None:
      data = {}

    urlpath = f"/0/private/{endpoint}"
    data["nonce"] = str(int(time.time() * 1000))

    headers = {
        "API-Key": self.creds.api_key,
        "API-Sign": self._generate_signature(
            urlpath, data, self.creds.api_secret
        ),
    }

    response = requests.post(
        f"{self.base_url}{urlpath}", headers=headers, data=data, timeout=10
    )
    res_data = response.json()

    if res_data.get("error"):
      raise RuntimeError(f"Kraken Private API Error: {res_data['error']}")

    return res_data.get("result", {})

  def get_account_balance(self) -> dict:
    """Fetches real account balance from Kraken."""
    if self.creds.paper_trading:
      return {"ZUSD": "10000.00", "XXBT": "0.00000000"}  # Simulated balance
    return self._private_request("Balance")

  def place_order(
      self,
      pair: str,
      order_type: str,
      direction: str,
      volume: float,
      price: float = None,
  ) -> dict:
    """Places a Market or Limit trade order on Kraken."""
    if self.creds.paper_trading:
      return {
          "status": "SIMULATED",
          "txid": ["SIMULATED_ORDER_12345"],
          "descr": (
              f"Simulated {direction.upper()} {volume} {pair} @"
              f" {price or 'MARKET'}"
          ),
      }

    data = {
        "pair": pair,
        "type": direction,  # 'buy' or 'sell'
        "ordertype": order_type,  # 'market' or 'limit'
        "volume": str(volume),
    }

    if order_type == "limit" and price:
      data["price"] = str(price)

    return self._private_request("AddOrder", data)


if __name__ == "__main__":
  creds = CredentialsManager()
  creds.validate_keys()
  executor = KrakenPrivateExecution(creds)

  # Check simulated or live balance
  balance = executor.get_account_balance()
  print("--- Account Balance ---")
  print(balance)
