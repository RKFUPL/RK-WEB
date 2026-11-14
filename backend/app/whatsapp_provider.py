"""Read-only Meta inventory/subscription diagnostics. Never writes to Meta."""
import re
import requests

from .whatsapp_templates import components_match, registry, meta_status


def read_inventory(config):
    observed, cursor, seen = {}, None, set()
    for page in range(1, 101):
        params = {"fields": "name,language,status,category,components,quality_score", "limit": 100}
        if cursor:
            params["after"] = cursor
        response = requests.get(
            f"https://graph.facebook.com/{config['WHATSAPP_API_VERSION']}/{config['WHATSAPP_BUSINESS_ACCOUNT_ID']}/message_templates",
            headers={"Authorization": "Bearer " + config["WHATSAPP_ACCESS_TOKEN"]}, params=params,
            timeout=(3.05, 10), allow_redirects=False,
        )
        response.raise_for_status()
        body = response.json()
        if not isinstance(body, dict) or not isinstance(body.get("data"), list):
            raise ValueError("invalid_inventory")
        for row in body["data"]:
            if (not isinstance(row, dict) or not isinstance(row.get("name"), str)
                    or not re.fullmatch(r"[a-z0-9_]{1,512}", row["name"])
                    or not isinstance(row.get("language"), str)
                    or not re.fullmatch(r"[a-z]{2,3}(?:_[A-Z]{2})?", row["language"])):
                raise ValueError("invalid_inventory_row")
            key = (row["name"], row["language"])
            if key in observed and observed[key] != row:
                raise ValueError("conflicting_inventory_rows")
            observed[key] = row
        paging = body.get("paging") or {}
        if not paging.get("next"):
            return observed, page
        cursor = (paging.get("cursors") or {}).get("after")
        if not isinstance(cursor, str) or not cursor or len(cursor) > 2000 or cursor in seen:
            raise ValueError("invalid_inventory_pagination")
        seen.add(cursor)
    raise ValueError("incomplete_inventory")


def audit_provider(config, app_access_token=None):
    """Return only allowlisted metadata; errors never render provider text."""
    from .whatsapp import CALLBACK
    inventory, pages = read_inventory(config)
    mappings = registry(config)
    rows = []
    for (name, language), row in sorted(inventory.items()):
        matches = [item for item in mappings.values() if (item["name"], item["language"]) == (name, language)]
        rows.append({"name": name, "language": language, "category": row.get("category"), "status": meta_status(row.get("status")),
                     "quality": (row.get("quality_score") or {}).get("score"),
                     "exactComponents": bool(matches and components_match(matches[0]["components"], row.get("components")))})
    result = {"pages": pages, "records": len(rows), "templates": rows}
    base = "https://graph.facebook.com/" + config["WHATSAPP_API_VERSION"]
    for kind, path, params, token in (
        ("wabaSubscription", config["WHATSAPP_BUSINESS_ACCOUNT_ID"] + "/subscribed_apps", {}, config["WHATSAPP_ACCESS_TOKEN"]),
        ("phone", config["WHATSAPP_BUSINESS_ACCOUNT_ID"] + "/phone_numbers", {"fields": "id,verified_name,code_verification_status,quality_rating"}, config["WHATSAPP_ACCESS_TOKEN"]),
        ("appWebhook", config["WHATSAPP_APP_ID"] + "/subscriptions", {}, app_access_token),
    ):
        if not token:
            result[kind] = {"verified": False, "reason": "app_access_token_required"}
            continue
        try:
            response = requests.get(base + "/" + path, headers={"Authorization": "Bearer " + token}, params=params,
                                    timeout=(3.05, 10), allow_redirects=False)
            response.raise_for_status()
            data = response.json().get("data")
            if not isinstance(data, list):
                raise ValueError()
            if kind == "wabaSubscription":
                result[kind] = {"verified": True, "configuredAppSubscribed": any(str((item.get("whatsapp_business_api_data") or {}).get("id")) == str(config["WHATSAPP_APP_ID"]) for item in data)}
            elif kind == "phone":
                phone = next((item for item in data if str(item.get("id")) == str(config["WHATSAPP_PHONE_NUMBER_ID"])), {})
                result[kind] = {"verified": True, "configuredPhoneBelongsToWaba": bool(phone), "codeVerification": phone.get("code_verification_status"), "quality": phone.get("quality_rating")}
            else:
                entries = [item for item in data if item.get("object") == "whatsapp_business_account" and item.get("active") is True]
                result[kind] = {"verified": True, "productionCallback": any(item.get("callback_url") == CALLBACK for item in entries),
                               "messagesField": any("messages" in [field.get("name") if isinstance(field, dict) else field for field in item.get("fields", [])] for item in entries)}
        except (requests.RequestException, ValueError, TypeError, AttributeError):
            result[kind] = {"verified": False, "reason": "provider_read_failed"}
    return result
