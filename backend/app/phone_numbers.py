"""Country-aware parsing without an inferred country for legacy local numbers."""
import re
import phonenumbers


def customer_phone(value, country=None):
    if not isinstance(value, str) or not re.fullmatch(r"\+?[0-9 ().-]{6,40}|00[0-9 ().-]{6,38}", value.strip()):
        raise ValueError("Enter a valid WhatsApp number and select its country code.")
    value = value.strip()
    country = str(country or "").upper()
    if country and country not in phonenumbers.SUPPORTED_REGIONS:
        raise ValueError("Select a valid telephone country.")
    if value.startswith("00"):
        value = "+" + value[2:]
    if not value.startswith("+") and not country:
        raise ValueError("Select the country code for your WhatsApp number.")
    try:
        parsed = phonenumbers.parse(value, country or None)
        actual = phonenumbers.region_code_for_number(parsed)
        if not phonenumbers.is_valid_number(parsed) or parsed.extension or (country and actual != country):
            raise ValueError()
    except (phonenumbers.NumberParseException, ValueError):
        raise ValueError("Enter a valid WhatsApp number for the selected country.") from None
    return phonenumbers.format_number(parsed, phonenumbers.PhoneNumberFormat.E164), actual
