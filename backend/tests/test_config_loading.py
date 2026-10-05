import os
import unittest
from pathlib import Path
from unittest.mock import patch

from app import _load_environment
from app.config import BaseConfig


class ConfigurationLoadingTests(unittest.TestCase):
    def test_process_environment_has_priority_over_local_files(self):
        root = Path(__file__).resolve().parents[1]
        with patch.dict(os.environ, {"RK_CONFIG_PRIORITY": "process"}, clear=False):
            with patch("app.load_dotenv"), patch("app.dotenv_values", return_value={"RK_CONFIG_PRIORITY": "local"}):
                _load_environment(root)
                self.assertEqual(os.environ["RK_CONFIG_PRIORITY"], "process")
        os.environ.pop("RK_CONFIG_PRIORITY", None)

    def test_local_file_overrides_base_file_when_process_is_unset(self):
        root = Path(__file__).resolve().parents[1]
        os.environ.pop("RK_CONFIG_PRIORITY", None)
        with patch("app.load_dotenv"), patch("app.dotenv_values", return_value={"RK_CONFIG_PRIORITY": "local"}):
            _load_environment(root)
            self.assertEqual(os.environ["RK_CONFIG_PRIORITY"], "local")
        os.environ.pop("RK_CONFIG_PRIORITY", None)

    def test_smtp_aliases_are_available_on_application_config(self):
        self.assertEqual(BaseConfig.SMTP_HOST, BaseConfig.ZOHO_SMTP_HOST)
        self.assertEqual(BaseConfig.SMTP_PORT, BaseConfig.ZOHO_SMTP_PORT)
        self.assertEqual(BaseConfig.SMTP_SECURE, BaseConfig.ZOHO_SMTP_SECURITY)
        self.assertEqual(BaseConfig.SMTP_USERNAME, BaseConfig.ZOHO_SMTP_USERNAME)
        self.assertEqual(bool(BaseConfig.SMTP_PASSWORD), bool(BaseConfig.ZOHO_SMTP_PASSWORD))


if __name__ == "__main__":
    unittest.main()
