import unittest
from unittest.mock import MagicMock, patch

from flask import Flask

from app.blueprints.catalog.routes import catalog_bp
from app.fx_rates import currency_context, currency_for_country


class FxRateTests(unittest.TestCase):
    def test_country_mapping_defaults_safely_to_inr(self):
        self.assertEqual(currency_for_country("IN"), "INR")
        self.assertEqual(currency_for_country("US"), "USD")
        self.assertEqual(currency_for_country("DE"), "EUR")
        self.assertEqual(currency_for_country("AE"), "AED")
        self.assertEqual(currency_for_country("GB"), "GBP")
        self.assertEqual(currency_for_country("ZZ"), "INR")

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
        self.assertEqual(payload["rateType"], "daily indicative reference rates")
        self.assertEqual(payload["ratesAsOf"], "2026-10-17")
        self.assertNotIn("provider", payload)

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
        self.assertEqual(payload["rateStatus"], "configured_fallback")
        self.assertNotIn("providerUrl", payload)


if __name__ == "__main__":
    unittest.main()
