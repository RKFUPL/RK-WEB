"""Only explicitly approved, enabled templates may leave the backend."""
import json
import re
import hashlib
from datetime import datetime, timedelta, timezone
from .whatsapp_catalogue import CATALOGUE, EVENT_CATALOGUE, STATUS_UPDATE_EVENTS
from .whatsapp_definitions import definitions, definition_components
from .time_utils import as_utc_datetime

META_TEMPLATE_STATUSES = {
    "APPROVED", "PENDING", "REJECTED", "PAUSED", "DISABLED", "IN_APPEAL",
    "PENDING_DELETION", "DELETED", "LIMIT_EXCEEDED", "ARCHIVED",
}
META_STATUS_MAX_AGE = timedelta(hours=24)


def observation_is_stale(observed, sync, account_id, at=None):
    if not observed:
        return False
    checked = as_utc_datetime(observed.get("checkedAt"))
    attempted = as_utc_datetime(sync.get("lastAttemptAt"))
    current = at or datetime.now(timezone.utc)
    return bool(observed.get("businessAccountId") != str(account_id or "") or sync.get("lastError")
        or (attempted and checked and attempted > checked)
        or not checked or current - checked > META_STATUS_MAX_AGE)


def meta_status(value):
    """Normalize documented Graph statuses while keeping unknown values untrusted."""
    return value if isinstance(value, str) and value in META_TEMPLATE_STATUSES else "MISSING_OR_UNKNOWN"

EVENTS = {
    "signup_otp": ("AUTHENTICATION", ("code",)),
    "login_otp": ("AUTHENTICATION", ("code",)),
    "forgot_password_otp": ("AUTHENTICATION", ("code",)),
    **{key: ("UTILITY", ("reference", "status")) for key in (
        "order_placed", "order_accepted", "order_rejected", "advance_payment_received", "part_payment_received", "payment_received",
        "order_confirmation", "payment_confirmation", "payment_failure", "processing",
        "packed", "shipped", "tracking_update", "out_for_delivery", "delivered",
        "cancelled", "return_requested", "return_status", "refund_initiated",
        "refund_completed", "custom_order_received", "custom_order_status", "admin_notification",
    )},
    "test": ("UTILITY", ()),
    "new_collection_drop": ("MARKETING", ("first_name", "collection_name")),
    "exclusive_offer": ("MARKETING", ("first_name", "offer_description", "coupon_code", "expiry_date")),
}
EVENTS["order_placed"] = ("UTILITY", tuple(CATALOGUE["rk_order_placed"]["parameters"]))
for event in ["order_accepted", "order_rejected", "advance_payment_received", "part_payment_received", "payment_received"]:
    EVENTS[event] = ("UTILITY", tuple(CATALOGUE["rk_order_status_update"]["parameters"]))
EVENTS["shipped"] = ("UTILITY", ("reference", "status", "tracking"))
EVENTS["tracking_update"] = ("UTILITY", ("reference", "status", "tracking"))

# Static components are rendered by Meta from the registered template. They
# are an exact contract for verification, not dynamic send-time parameters.
LOCAL_TEST_TEMPLATE = {
    "name": "3p_direct_integration_test_template", "language": "en_US", "category": "UTILITY",
    "components": [
        {"type": "HEADER", "format": "TEXT", "text": "Integration Test"},
        {"type": "BODY", "text": "Welcome! This is a test message from the WhatsApp Business Platform. You have successfully configured your WhatsApp Business account and completed onboarding. You can now start sending messages to your customers."},
        {"type": "FOOTER", "text": "WhatsApp Business Platform"},
    ],
}


def component_signature(components):
    return hashlib.sha256(json.dumps(components, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def components_match(expected, actual):
    # Meta may attach submission examples to variable components. Those are
    # examples, not additional header/body/button definitions.
    if not isinstance(actual, list) or any(not isinstance(item, dict) for item in actual):
        return False
    def without_examples(value):
        if isinstance(value, dict):
            return {key: without_examples(item) for key, item in value.items() if key != "example"}
        return [without_examples(item) for item in value] if isinstance(value, list) else value
    cleaned = without_examples(actual)
    if cleaned == expected:
        return True
    if expected and expected[0].get("add_security_recommendation") is True and len(cleaned) == 3:
        body, footer, buttons = cleaned
        if [item.get("type") for item in cleaned] != ["BODY", "FOOTER", "BUTTONS"]:
            return False
        secure = body.get("add_security_recommendation", body.get("text") == "*{{1}}* is your verification code. For your security, do not share this code.") is True
        expiry = footer.get("code_expiration_minutes", 10 if footer.get("text") == "This code expires in 10 minutes." else None) == 10
        items = buttons.get("buttons") or []
        if len(items) != 1 or items[0].get("text") != "Copy code":
            return False
        button = items[0]
        copy_code = button.get("type") == "OTP" and button.get("otp_type") == "COPY_CODE"
        # Some Graph versions expose the rendered Copy Code button as URL.
        copy_code = copy_code or (button.get("type") == "URL" and button.get("url") == "https://www.whatsapp.com/otp/code/?otp_type=COPY_CODE&code=otp{{1}}")
        return secure and expiry and copy_code
    return False


def test_parameter_fields(template):
    """Derive one-off test inputs from the exact verified component contract.

    Only text headers, body variables, and dynamic URL buttons are supported.
    Media headers and non-URL buttons need provider-specific assets or consent
    flows and therefore stay unavailable to this generic test sender.
    """
    fields = []
    components = template.get("components")
    if not isinstance(components, list):
        return None

    def slots(text, component, component_index=None):
        matches = re.findall(r"\{\{([1-9][0-9]?)\}\}", text if isinstance(text, str) else "")
        numbers = sorted({int(value) for value in matches})
        if numbers != list(range(1, len(numbers) + 1)):
            return None
        result = []
        for number in numbers:
            if component == "button":
                key = f"button_{component_index}_{number}"
                label = f"Button {component_index + 1} parameter {number}"
            else:
                key = f"{component}_{number}"
                label = f"{component.title()} parameter {number}"
                if component == "body" and number <= len(template.get("parameters", [])):
                    label = f"Body variable {number}: {template['parameters'][number - 1]}"
            result.append({"key": key, "label": label, "component": component, "index": component_index, "number": number})
        return result

    for component in components:
        if not isinstance(component, dict):
            return None
        kind = component.get("type")
        if kind == "HEADER":
            if component.get("format") != "TEXT":
                return None
            found = slots(component.get("text"), "header")
            if found is None:
                return None
            fields.extend(found)
        elif kind == "BODY":
            found = slots(component.get("text"), "body")
            if found is None:
                return None
            fields.extend(found)
        elif kind == "BUTTONS":
            buttons = component.get("buttons", [])
            if not isinstance(buttons, list):
                return None
            for index, button in enumerate(buttons):
                if not isinstance(button, dict):
                    return None
                if button.get("type") != "URL":
                    if re.search(r"\{\{[1-9][0-9]?\}\}", str(button.get("url") or "")):
                        return None
                    continue
                found = slots(button.get("url"), "button", index)
                if found is None:
                    return None
                fields.extend(found)
        elif kind not in {"FOOTER"}:
            return None
    return fields


def legacy_contract_valid(components, parameters):
    """Legacy Utility contracts support ordered body text and static text only.

    More complex contracts must use an explicit reviewed catalogue schema.
    Provider approval and exact matching are still independently required.
    """
    if not isinstance(components, list) or not components or any(not isinstance(c, dict) for c in components):
        return False
    body = [c for c in components if c.get("type") == "BODY"]
    if len(body) != 1 or not isinstance(body[0].get("text"), str):
        return False
    numbers = re.findall(r"\{\{([1-9][0-9]*)\}\}", body[0]["text"])
    if sorted({int(n) for n in numbers}) != list(range(1, len(parameters) + 1)):
        return False
    for c in components:
        if c.get("type") == "BODY":
            continue
        if c.get("type") not in {"HEADER", "FOOTER"} or not isinstance(c.get("text"), str) or "{{" in c["text"]:
            return False
        if c["type"] == "HEADER" and c.get("format") != "TEXT":
            return False
    return True


def registry(config):
    catalogue = definitions(config)
    raw = config.get("WHATSAPP_TEMPLATES", "{}")
    try:
        overrides = json.loads(raw) if isinstance(raw, str) else raw
    except (ValueError, TypeError):
        overrides = {}
    if not isinstance(overrides, dict):
        overrides = {}
    result = {}
    for event, (category, parameters) in EVENTS.items():
        entry = overrides.get(event, {})
        if not isinstance(entry, dict):
            entry = {}
        # Nonempty legacy entries retain the original 21-event schema. New
        # mappings opt in explicitly; empty config shows the submission plan.
        default = {"new_collection_drop": "rk_new_collection_drop", "exclusive_offer": "rk_exclusive_offer"}.get(event, EVENT_CATALOGUE.get(event))
        catalogue_name = entry.get("catalogue") or (default if not entry else None)
        spec = catalogue.get(catalogue_name) if isinstance(catalogue_name, str) else None
        if spec:
            category, parameters = spec["category"], tuple(spec["parameters"])
        default_name = LOCAL_TEST_TEMPLATE["name"] if event == "test" and config.get("WHATSAPP_ENVIRONMENT") == "development" else (spec["name"] if spec else "rk_" + event)
        name = entry.get("name", default_name)
        language = entry.get("language", "en_US")
        local_test = name == LOCAL_TEST_TEMPLATE["name"]
        # Every mapping needs provider evidence; legacy operator flags never
        # establish approval, including optional lifecycle/internal templates.
        requires_meta = True
        components = LOCAL_TEST_TEMPLATE["components"] if local_test else (definition_components(spec) if spec else entry.get("components", []))
        contract_valid = bool(local_test or spec or legacy_contract_valid(components, parameters))
        valid = isinstance(name, str) and re.fullmatch(r"[a-z0-9_]{1,512}", name)
        valid = valid and isinstance(language, str) and re.fullmatch(r"[a-z]{2,3}(?:_[A-Z]{2})?", language)
        valid = valid and (not catalogue_name or bool(spec and event in spec["events"] and name == spec["name"] and language == spec["language"]))
        valid = valid and entry.get("category", category) == category
        if entry.get("catalogue"):
            valid = valid and entry.get("category") == category
        valid = valid and entry.get("parameters", list(parameters)) == list(parameters)
        types = spec["parameterTypes"] if spec else ["otp" if p == "code" else "text" for p in parameters]
        valid = valid and entry.get("parameterTypes", types) == types
        valid = valid and all(button.get("url") for button in (spec or {}).get("buttons", []))
        if local_test:
            valid = valid and event == "test"
            valid = valid and language == LOCAL_TEST_TEMPLATE["language"] and category == LOCAL_TEST_TEMPLATE["category"]
            valid = valid and not parameters and entry.get("components", LOCAL_TEST_TEMPLATE["components"]) == LOCAL_TEST_TEMPLATE["components"]
        # Retain legacy configuration syntax only as local metadata.
        status = entry.get("approvalStatus", "APPROVED" if entry.get("approved") is True else "NOT_SUBMITTED")
        valid = valid and isinstance(status, str) and status in {"NOT_SUBMITTED", "PENDING", "APPROVED", "REJECTED", "PAUSED", "DISABLED", "IN_APPEAL", "PENDING_DELETION", "DELETED"}
        valid = valid and not (entry.get("approved") is False and status == "APPROVED")
        result[event] = {
            "name": name if valid else "", "language": language if valid else "",
            "category": category, "parameters": list(parameters), "parameterTypes": types,
            "catalogue": catalogue_name, "schemaVersion": 2 if spec else 1, "configured": bool(valid),
            "approvalStatus": status if valid else "INVALID_CONFIGURATION",
            "approvalSource": "unconfirmed",
            "requiresMetaApproval": requires_meta,
            "components": components,
            "componentContractValid": contract_valid,
            "templateGroup": "Integration Test" if local_test else "Authentication" if category == "AUTHENTICATION" else "Marketing" if category == "MARKETING" else "Internal only" if event == "admin_notification" else "Transactional" if event in set(STATUS_UPDATE_EVENTS) | {"order_placed", "order_confirmation", "payment_confirmation"} else "Optional lifecycle drafts",
            "buttons": (spec or {}).get("buttons", []), "buttonParameters": (spec or {}).get("buttonParameters", []),
            "definitionEvents": (spec or {}).get("events", []),
            "enabled": bool(valid and entry.get("enabled") is True),
            "approved": False,
        }
    return result


def template_registry(db, config):
    """Observed revocations override a configured approval, never auto-enable."""
    result = registry(config)
    sync = (db.integrations.find_one({"_id": "whatsapp"}) or {}).get("templateStatusSync") or {}
    for template in result.values():
        observed = db.whatsapp_template_status.find_one({"_id": template["name"] + ":" + template["language"]})
        same_account = bool(observed and observed.get("businessAccountId") == str(config.get("WHATSAPP_BUSINESS_ACCOUNT_ID") or ""))
        stale = observation_is_stale(observed, sync, config.get("WHATSAPP_BUSINESS_ACCOUNT_ID"))
        if observed:
            template["observedStatus"] = observed.get("status", "UNKNOWN")
            template["qualityRating"] = observed.get("qualityRating")
            template["approvalCheckedAt"] = observed.get("checkedAt")
            template["observedComponents"] = observed.get("components", [])
            template["statusEvidence"] = observed.get("evidenceState", "legacy_unscoped_evidence")
            template["statusStale"] = stale
            template["presentInMeta"] = observed.get("presentInMeta")
            template["localDraft"] = bool(observed.get("presentInMeta") is False and template["approvalStatus"] in {"NOT_SUBMITTED", "MISSING_OR_UNKNOWN"})
            if template["localDraft"]:
                template["draftExplanation"] = {
                    "rk_authentication_otp": "Meta previously denied Authentication-template creation for this WABA; this local draft was not submitted.",
                    "rk_exclusive_offer": "Blocked until checkout has an integrated, validated coupon and promotion system; this local draft was not submitted.",
                    "rk_admin_notification": "Internal-only notification draft; excluded from customer-facing submissions and not submitted.",
                }.get(template["name"], "Local definition is absent from the last complete Meta inventory and has not been submitted.")
            template["metaComponents"] = observed.get("metaComponents", [])
            template["componentMismatches"] = observed.get("mismatches", [])
            template["componentsVerified"] = bool(observed.get("componentsVerified") is True
                and observed.get("componentSignature") == component_signature(template["components"]))
            template["approved"] = bool(template["approved"] and same_account and not stale
                and observed.get("presentInMeta") is True and observed.get("status") == "APPROVED"
                and observed.get("category") == template["category"])
        if template["requiresMetaApproval"]:
            template["approvalStatus"] = observed.get("status", "MISSING_OR_UNKNOWN") if observed else "MISSING_OR_UNKNOWN"
            template["observedStatus"] = observed.get("status", "MISSING_OR_UNKNOWN") if observed else "MISSING_OR_UNKNOWN"
            template["approvalSource"] = "meta_api_read" if observed and observed.get("source") == "meta_api_read" and same_account and not stale else "unconfirmed"
            template["componentsVerified"] = bool(observed and same_account and not stale and observed.get("componentsVerified") is True and observed.get("componentSignature") == component_signature(template["components"]))
            template["metaComponents"] = observed.get("metaComponents", []) if observed else []
            template["componentMismatches"] = observed.get("mismatches", []) if observed else []
            template["approved"] = bool(template["configured"] and template["componentContractValid"] and template["components"] and observed and same_account and not stale and observed.get("source") == "meta_api_read"
                and observed.get("name") == template["name"] and observed.get("language") == template["language"]
                and observed.get("presentInMeta") is True
                and observed.get("status") == "APPROVED" and observed.get("category") == template["category"]
                and (template["category"] != "AUTHENTICATION" or bool(template["catalogue"]))
                and observed.get("componentsVerified") is True
                and observed.get("componentSignature") == component_signature(template["components"]))
        template["disabledReasons"] = (["invalid_or_missing_mapping"] if not template["configured"] else []) + (["local_mapping_disabled"] if not template["enabled"] else []) + (["meta_approval_or_components_unconfirmed"] if not template["approved"] else [])
    return result
