"""UTC timestamp normalization and JSON serialization helpers."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from bson import ObjectId


def as_utc_datetime(value: object) -> datetime | None:
    """Return a datetime normalized to UTC.

    PyMongo installations that do not enable ``tz_aware`` return BSON dates
    as naive datetimes. MongoDB stores those dates as UTC, so a naive value
    from the database is explicitly treated as UTC here instead of being
    interpreted in the server's local timezone.
    """
    if not isinstance(value, datetime):
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def isoformat_utc(value: object) -> str | None:
    """Serialize a datetime as an unambiguous UTC ISO-8601 value."""
    normalized = as_utc_datetime(value)
    return normalized.isoformat().replace("+00:00", "Z") if normalized else None


def json_value(value: Any) -> Any:
    """Recursively convert Mongo values to JSON-safe values."""
    if isinstance(value, datetime):
        return isoformat_utc(value)
    if isinstance(value, ObjectId):
        return str(value)
    if isinstance(value, list):
        return [json_value(item) for item in value]
    if isinstance(value, dict):
        return {key: json_value(item) for key, item in value.items()}
    return value
