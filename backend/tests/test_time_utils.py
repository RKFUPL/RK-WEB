from datetime import datetime, timedelta, timezone
import unittest

from app.time_utils import isoformat_utc, json_value


class TimeUtilsTests(unittest.TestCase):
    def test_naive_mongo_datetime_is_serialized_as_utc(self):
        value = datetime(2026, 8, 17, 16, 25)
        self.assertEqual(isoformat_utc(value), "2026-08-17T16:25:00Z")

    def test_offset_datetime_is_normalized_to_utc(self):
        value = datetime(2026, 8, 17, 21, 55, tzinfo=timezone(timedelta(hours=5, minutes=30)))
        self.assertEqual(isoformat_utc(value), "2026-08-17T16:25:00Z")

    def test_nested_mongo_values_are_json_safe(self):
        value = {"createdAt": datetime(2026, 8, 17, 16, 25), "events": [{"at": datetime(2026, 8, 17, 16, 26)}]}
        self.assertEqual(json_value(value), {"createdAt": "2026-08-17T16:25:00Z", "events": [{"at": "2026-08-17T16:26:00Z"}]})


if __name__ == "__main__":
    unittest.main()
