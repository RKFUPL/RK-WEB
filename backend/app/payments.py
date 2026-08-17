"""Small Razorpay integration primitives kept outside the HTTP blueprint.

The browser only receives the public key id. API authentication, payment
verification, and webhook verification stay in this server-side module.
"""

import base64
import hashlib
import hmac
import json
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


RAZORPAY_API_BASE = "https://api.razorpay.com/v1"


class RazorpayAPIError(RuntimeError):
    def __init__(self, message: str, status_code: int | None = None, payload: Any = None):
        super().__init__(message)
        self.status_code = status_code
        self.payload = payload


def is_configured(config: Any) -> bool:
    mode = str(config.get("RAZORPAY_MODE") or "test").strip().lower()
    return mode == "test" and bool(str(config.get("RAZORPAY_KEY_ID") or "").strip() and str(config.get("RAZORPAY_KEY_SECRET") or "").strip())


def verify_payment_signature(order_id: str, payment_id: str, received_signature: str, secret: str) -> bool:
    message = f"{order_id}|{payment_id}".encode("utf-8")
    expected = hmac.new(secret.encode("utf-8"), message, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, str(received_signature or ""))


def verify_webhook_signature(raw_body: bytes, received_signature: str, secret: str) -> bool:
    expected = hmac.new(secret.encode("utf-8"), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, str(received_signature or ""))


def razorpay_api_request(config: Any, method: str, path: str, payload: dict | None = None) -> dict:
    """Call the Razorpay REST API without putting a server secret in client code."""
    key_id = str(config.get("RAZORPAY_KEY_ID") or "").strip()
    key_secret = str(config.get("RAZORPAY_KEY_SECRET") or "").strip()
    if not key_id or not key_secret:
        raise RazorpayAPIError("Razorpay Test Mode is not configured.")

    credentials = base64.b64encode(f"{key_id}:{key_secret}".encode("utf-8")).decode("ascii")
    body = json.dumps(payload).encode("utf-8") if payload is not None else None
    request = Request(
        f"{RAZORPAY_API_BASE}{path}",
        data=body,
        method=method.upper(),
        headers={
            "Authorization": f"Basic {credentials}",
            "Accept": "application/json",
            "Content-Type": "application/json",
        },
    )
    try:
        with urlopen(request, timeout=15) as response:
            raw = response.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except HTTPError as error:
        raw = error.read().decode("utf-8", errors="replace")
        try:
            detail = json.loads(raw)
        except json.JSONDecodeError:
            detail = None
        message = "Razorpay request failed."
        if isinstance(detail, dict):
            message = str(detail.get("error", {}).get("description") or detail.get("message") or message)
        raise RazorpayAPIError(message, error.code, detail) from error
    except (URLError, TimeoutError, OSError) as error:
        raise RazorpayAPIError("Razorpay could not be reached.") from error
