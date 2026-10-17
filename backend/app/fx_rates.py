"""Server-side display exchange rates with bounded caching and safe fallback."""

from __future__ import annotations

from datetime import datetime, timezone
from threading import Lock
from time import monotonic

import requests


SUPPORTED_FOREIGN_CURRENCIES = ("USD", "EUR", "AED", "GBP")
_cache_lock = Lock()
_cache: dict[str, object] = {"rates": {}, "fetched_at": 0.0, "as_of": None, "provider_url": None}


def _valid_rates(value) -> dict[str, float]:
    source = value if isinstance(value, dict) else {}
    result: dict[str, float] = {}
    for currency in SUPPORTED_FOREIGN_CURRENCIES:
        rate = source.get(currency)
        if isinstance(rate, (int, float)) and not isinstance(rate, bool) and 0 < float(rate) < 1_000:
            result[currency] = float(rate)
    return result


def _configured_fallback(config) -> dict[str, float]:
    return _valid_rates(config.get("PUBLIC_FX_RATES"))


def currency_context(config, *, country_code: str = "", now=None) -> dict:
    """Return public display rates and freshness metadata without provider secrets."""
    now = now or datetime.now(timezone.utc)
    ttl = max(60, int(config.get("FX_CACHE_TTL_SECONDS") or 21_600))
    provider_url = str(config.get("FX_PROVIDER_URL") or "").strip()

    with _cache_lock:
        cached = _valid_rates(_cache.get("rates"))
        age = monotonic() - float(_cache.get("fetched_at") or 0)
        if provider_url and _cache.get("provider_url") == provider_url and cached and age < ttl:
            return _context_payload(cached, "live", _cache.get("as_of"), country_code)

    if provider_url:
        try:
            response = requests.get(provider_url, timeout=(2.5, 5))
            response.raise_for_status()
            payload = response.json()
            rates = _valid_rates(payload.get("rates") or payload.get("conversion_rates"))
            if len(rates) != len(SUPPORTED_FOREIGN_CURRENCIES):
                raise ValueError("FX provider omitted a supported currency")
            as_of = payload.get("time_last_update_utc") or payload.get("date") or now.isoformat()
            with _cache_lock:
                _cache.update(rates=rates, fetched_at=monotonic(), as_of=str(as_of), provider_url=provider_url)
            return _context_payload(rates, "live", str(as_of), country_code)
        except (requests.RequestException, ValueError, TypeError):
            with _cache_lock:
                stale = _valid_rates(_cache.get("rates")) if _cache.get("provider_url") == provider_url else {}
                stale_as_of = _cache.get("as_of") if stale else None
            if stale:
                return _context_payload(stale, "stale", stale_as_of, country_code)

    fallback = _configured_fallback(config)
    status = "configured_fallback" if fallback else "unavailable"
    return _context_payload(fallback, status, None, country_code)


def _context_payload(rates: dict[str, float], status: str, as_of, country_code: str) -> dict:
    if status in {"live", "stale"}:
        source, rate_type = "ExchangeRate-API", "daily indicative reference rates"
    elif status == "configured_fallback":
        source, rate_type = "Configured fallback", "fallback display rates"
    else:
        source, rate_type = None, None
    return {
        "baseCurrency": "INR",
        "rates": rates,
        "rateStatus": status,
        "ratesAsOf": as_of,
        "source": source,
        "rateType": rate_type,
        "detectedCurrency": currency_for_country(country_code),
    }


def currency_for_country(country_code: str) -> str:
    code = str(country_code or "").strip().upper()
    if code == "IN":
        return "INR"
    if code == "US":
        return "USD"
    if code == "AE":
        return "AED"
    if code in {"GB", "UK"}:
        return "GBP"
    if code in {
        "AT", "BE", "HR", "CY", "EE", "FI", "FR", "DE", "GR", "IE", "IT",
        "LV", "LT", "LU", "MT", "NL", "PT", "SK", "SI", "ES",
    }:
        return "EUR"
    return "INR"
