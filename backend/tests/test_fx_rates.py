import unittest
from unittest.mock import MagicMock, patch

import requests
from flask import Flask

from app.blueprints.admin.routes import admin_bp
from app.blueprints.catalog.routes import catalog_bp
from app.fx_rates import _cache, currency_context, currency_for_country


class FxRateTests(unittest.TestCase):
    def setUp(self):
        _cache.update(rates={}, fetched_at=0.0, as_of=None, provider_id=None)

    def test_country_mapping_defaults_safely_to_inr(self):
        self.assertEqual(currency_for_country("IN"), "INR")
        self.assertEqual(currency_for_country("US"), "USD")
        self.assertEqual(currency_for_country("DE"), "EUR")
        self.assertEqual(currency_for_country("AE"), "AED")
        self.assertEqual(currency_for_country("GB"), "GBP")
        self.assertEqual(currency_for_country("ZZ"), "INR")

    def test_missing_provider_configuration_is_safely_unavailable(self):
        payload = currency_context({})
        self.assertEqual(payload["rateStatus"], "unavailable")
        self.assertEqual(payload["rates"], {})
        self.assertFalse(payload["twelveData"]["configured"])

    @patch("app.fx_rates.requests.get")
    def test_live_provider_rates_are_validated_and_metadata_is_safe(self, get):
        response = MagicMock()
        response.json.return_value = {
            "rates": {"USD": 0.012, "EUR": 0.011, "AED": 0.044, "GBP": 0.0094},
            "date": "2026-10-17",
        }
        get.return_value = response
        payload = currency_context({"FX_PROVIDER_URL": "https://provider.invalid/latest/INR", "FX_CACHE_TTL_SECONDS": 60}, country_code="AE")
        self.assertEqual(payload["rateStatus"], "live")
        self.assertEqual(payload["detectedCurrency"], "AED")
        self.assertEqual(set(payload["rates"]), {"USD", "EUR", "AED", "GBP"})
        self.assertEqual(payload["source"], "ExchangeRate-API")
        self.assertEqual(payload["rateType"], "indicative reference rates")
        self.assertEqual(payload["ratesAsOf"], "2026-10-17")
        self.assertNotIn("provider", payload)

    @patch("app.fx_rates.requests.get")
    def test_twelve_data_uses_inr_as_base_and_caches_all_supported_pairs(self, get):
        get.side_effect = [
            MagicMock(json=lambda rate=rate: {"rate": rate, "timestamp": 1_798_761_600}, raise_for_status=lambda: None)
            for rate in (0.012, 0.011, 0.044, 0.0094)
        ]
        config = {"TWELVE_DATA_API_KEY": "private-key", "TWELVE_DATA_COMMERCIAL_USE_APPROVED": True, "FX_CACHE_TTL_SECONDS": 3600}
        first = currency_context(config)
        second = currency_context(config)
        self.assertEqual(first["source"], "Twelve Data")
        self.assertEqual(first["rates"]["USD"], 0.012)
        self.assertEqual(get.call_count, 4)
        self.assertEqual([call.kwargs["params"]["symbol"] for call in get.call_args_list], ["INR/USD", "INR/EUR", "INR/AED", "INR/GBP"])
        self.assertNotIn("private-key", str(first))
        self.assertEqual(second["rates"], first["rates"])

    @patch("app.fx_rates.requests.get")
    def test_twelve_data_refresh_failure_preserves_last_valid_rates(self, get):
        get.side_effect = [
            *[MagicMock(json=lambda rate=rate: {"rate": rate}, raise_for_status=lambda: None) for rate in (0.012, 0.011, 0.044, 0.0094)],
            requests.ConnectionError("provider unavailable"),
        ]
        config = {"TWELVE_DATA_API_KEY": "private-key", "TWELVE_DATA_COMMERCIAL_USE_APPROVED": True, "FX_CACHE_TTL_SECONDS": 60}
        valid = currency_context(config)
        stale = currency_context(config, force_refresh=True)
        self.assertEqual(stale["rateStatus"], "stale")
        self.assertEqual(stale["rates"], valid["rates"])
        self.assertEqual(_cache["rates"], valid["rates"])

    @patch("app.fx_rates.requests.get")
    def test_twelve_data_rate_limit_uses_configured_fallback_without_fabricating_rates(self, get):
        limited = requests.Response()
        limited.status_code = 429
        get.return_value = limited
        fallback = {"USD": 0.012, "EUR": 0.011, "AED": 0.044, "GBP": 0.0094}
        payload = currency_context({"TWELVE_DATA_API_KEY": "private-key", "TWELVE_DATA_COMMERCIAL_USE_APPROVED": True, "PUBLIC_FX_RATES": fallback})
        self.assertEqual(payload["rateStatus"], "configured_fallback")
        self.assertEqual(payload["rates"], fallback)

    @patch("app.fx_rates.requests.get")
    def test_twelve_data_invalid_response_is_rejected(self, get):
        get.return_value = MagicMock(json=lambda: {"status": "ok", "rate": "not-a-number"}, raise_for_status=lambda: None)
        payload = currency_context({"TWELVE_DATA_API_KEY": "private-key", "TWELVE_DATA_COMMERCIAL_USE_APPROVED": True})
        self.assertEqual(payload["rateStatus"], "unavailable")
        self.assertEqual(payload["rates"], {})

    @patch("app.fx_rates.requests.get")
    def test_twelve_data_is_not_activated_without_commercial_approval(self, get):
        payload = currency_context({"TWELVE_DATA_API_KEY": "private-key", "TWELVE_DATA_COMMERCIAL_USE_APPROVED": False, "FX_PROVIDER_URL": "", "PUBLIC_FX_RATES": {"USD": 0.012}})
        self.assertEqual(payload["rateStatus"], "configured_fallback")
        self.assertFalse(payload["twelveData"]["active"])
        get.assert_not_called()

    def test_catalog_currency_context_returns_safe_configured_rates(self):
        app = Flask(__name__)
        app.config.update(
            FX_PROVIDER_URL="",
            PUBLIC_FX_RATES={"USD": 0.012, "EUR": 0.011, "AED": 0.044, "GBP": 0.0094},
        )
        app.register_blueprint(catalog_bp, url_prefix="/api/catalog")

        response = app.test_client().get(
            "/api/catalog/currency-context",
            headers={"CF-IPCountry": "GB"},
        )

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(payload["baseCurrency"], "INR")
        self.assertEqual(payload["detectedCurrency"], "GBP")
        self.assertEqual(set(payload), {"baseCurrency", "rates", "detectedCurrency"})
        self.assertNotIn("providerUrl", payload)

    def test_admin_forex_endpoint_requires_authentication(self):
        app = Flask(__name__)
        app.config.update(JWT_SECRET_KEY="test-secret-key-with-sufficient-length", TESTING=True)
        from flask_jwt_extended import JWTManager
        JWTManager(app)
        app.register_blueprint(admin_bp, url_prefix="/api/admin")
        self.assertEqual(app.test_client().get("/api/admin/forex").status_code, 401)


if __name__ == "__main__":
    unittest.main()
