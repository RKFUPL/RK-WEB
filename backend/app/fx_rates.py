"""Server-side display exchange rates with bounded caching and safe fallback."""

from __future__ import annotations

from datetime import datetime, timezone
from threading import Lock
from time import monotonic

import requests


SUPPORTED_FOREIGN_CURRENCIES = ("USD", "EUR", "AED", "GBP")
_cache_lock = Lock()
_cache: dict[str, object] = {"rates": {}, "fetched_at": 0.0, "as_of": None, "provider_id": None}


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


def _provider(config) -> tuple[str, str]:
    key = str(config.get("TWELVE_DATA_API_KEY") or "").strip()
    approved = config.get("TWELVE_DATA_COMMERCIAL_USE_APPROVED") is True
    if key and approved:
        return "twelve_data", "twelve_data"
    url = str(config.get("FX_PROVIDER_URL") or "").strip()
    return ("legacy", url) if url else ("", "")


def _fetch_twelve_data(config, now: datetime) -> tuple[dict[str, float], str]:
    rates: dict[str, float] = {}
    timestamps: list[int] = []
    for currency in SUPPORTED_FOREIGN_CURRENCIES:
        response = requests.get(
            "https://api.twelvedata.com/exchange_rate",
            params={"symbol": f"INR/{currency}", "apikey": config["TWELVE_DATA_API_KEY"]},
            timeout=(2.5, 5),
        )
        response.raise_for_status()
        payload = response.json()
        if payload.get("status") == "error":
            raise ValueError("Twelve Data rejected an exchange-rate request")
        rate = payload.get("rate")
        if not isinstance(rate, (int, float, str)) or isinstance(rate, bool):
            raise ValueError("Twelve Data returned an invalid exchange rate")
        rates[currency] = float(rate)
        if isinstance(payload.get("timestamp"), int):
            timestamps.append(payload["timestamp"])
    valid = _valid_rates(rates)
    if len(valid) != len(SUPPORTED_FOREIGN_CURRENCIES):
        raise ValueError("Twelve Data omitted a supported currency")
    as_of = datetime.fromtimestamp(max(timestamps), timezone.utc).isoformat() if timestamps else now.isoformat()
    return valid, as_of


def _fetch_legacy(config, now: datetime) -> tuple[dict[str, float], str]:
    response = requests.get(str(config["FX_PROVIDER_URL"]).strip(), timeout=(2.5, 5))
    response.raise_for_status()
    payload = response.json()
    rates = _valid_rates(payload.get("rates") or payload.get("conversion_rates"))
    if len(rates) != len(SUPPORTED_FOREIGN_CURRENCIES):
        raise ValueError("FX provider omitted a supported currency")
    return rates, str(payload.get("time_last_update_utc") or payload.get("date") or now.isoformat())


def currency_context(config, *, country_code: str = "", now=None, force_refresh: bool = False) -> dict:
    """Return validated conversion rates while keeping provider credentials private."""
    now = now or datetime.now(timezone.utc)
    ttl = max(60, int(config.get("FX_CACHE_TTL_SECONDS") or 21_600))
    provider_name, provider_id = _provider(config)

    with _cache_lock:
        cached = _valid_rates(_cache.get("rates"))
        age = monotonic() - float(_cache.get("fetched_at") or 0)
        if not force_refresh and provider_id and _cache.get("provider_id") == provider_id and cached and age < ttl:
            return _context_payload(cached, "live", _cache.get("as_of"), country_code, provider_name, ttl, config)

    if provider_id:
        try:
            rates, as_of = _fetch_twelve_data(config, now) if provider_name == "twelve_data" else _fetch_legacy(config, now)
            with _cache_lock:
                _cache.update(rates=rates, fetched_at=monotonic(), as_of=as_of, provider_id=provider_id)
            return _context_payload(rates, "live", as_of, country_code, provider_name, ttl, config)
        except (requests.RequestException, ValueError, TypeError, KeyError):
            with _cache_lock:
                stale = _valid_rates(_cache.get("rates")) if _cache.get("provider_id") == provider_id else {}
                stale_as_of = _cache.get("as_of") if stale else None
            if stale:
                return _context_payload(stale, "stale", stale_as_of, country_code, provider_name, ttl, config)

    fallback = _configured_fallback(config)
    status = "configured_fallback" if fallback else "unavailable"
    return _context_payload(fallback, status, None, country_code, "configured_fallback" if fallback else "", ttl, config)


def _context_payload(rates: dict[str, float], status: str, as_of, country_code: str, provider: str, ttl: int, config) -> dict:
    source = "Twelve Data" if provider == "twelve_data" else "ExchangeRate-API" if provider == "legacy" else "Configured fallback" if provider == "configured_fallback" else None
    return {
        "baseCurrency": "INR",
        "rates": rates,
        "rateStatus": status,
        "ratesAsOf": as_of,
        "source": source,
        "rateType": "indicative reference rates" if source else None,
        "detectedCurrency": currency_for_country(country_code),
        "refreshIntervalSeconds": ttl,
        "twelveData": {
            "configured": bool(str(config.get("TWELVE_DATA_API_KEY") or "").strip()),
            "commercialUseApproved": config.get("TWELVE_DATA_COMMERCIAL_USE_APPROVED") is True,
            "active": provider == "twelve_data",
        },
    }


def public_currency_context(config, *, country_code: str = "") -> dict:
    context = currency_context(config, country_code=country_code)
    return {key: context[key] for key in ("baseCurrency", "rates", "detectedCurrency")}


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
