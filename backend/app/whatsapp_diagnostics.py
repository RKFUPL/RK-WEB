"""Allowlisted explanations; never persist untrusted provider error strings."""

PRODUCTION_TEST_REASONS = {
    "production_test_disabled": "Manual production testing is off. The production backend must explicitly set WHATSAPP_PRODUCTION_TEST_SEND_ENABLED=true and WHATSAPP_PRODUCTION_TEST_SEND_EXPIRES_AT to a valid short-lived UTC expiry, then recreate the backend container. This cannot be enabled by the general messaging or order-notification switches.",
    "production_test_unsafe_gates": "Manual production testing requires WHATSAPP_ENABLED, WHATSAPP_TEST_SEND_ENABLED and WHATSAPP_MARKETING_ENABLED to remain false.",
    "production_test_expiry_invalid": "Set WHATSAPP_PRODUCTION_TEST_SEND_EXPIRES_AT to a valid ISO 8601 timestamp explicitly in UTC (Z or +00:00).",
    "production_test_expired": "The manual production test window has expired. A new short-lived UTC expiry requires operator authorization.",
    "production_test_expiry_too_far": "The production test expiry must be no more than 24 hours from the current UTC time.",
}


def application_diagnostics(config, state, recorded_failure=None):
    """Describe evidence and configuration; never authorize or activate sending."""
    from .whatsapp import production_test_state
    rows = []
    def add(code, severity, message):
        rows.append({"code": code, "severity": severity, "message": message})
    if config.get("WHATSAPP_ENVIRONMENT") == "production":
        reason = production_test_state(config)["reason"]
        if reason:
            add(reason, "warning", PRODUCTION_TEST_REASONS[reason])
    errors = [state.get("lastError") or {}]
    if recorded_failure:
        errors.extend([recorded_failure.get("error") or {}, recorded_failure.get("failureDetails") or {}])
    codes = set()
    for error in errors:
        if not isinstance(error, dict):
            continue
        for item in [error, *(error.get("errors") if isinstance(error.get("errors"), list) else [])]:
            if isinstance(item, dict) and isinstance(item.get("code"), int):
                codes.add(item["code"])
    if 131042 in codes:
        add("meta_billing_issue_recorded", "warning", "A recorded Meta failure reports a business eligibility or payment issue (131042). Review this WABA in Meta Billing & Payments. A successful card charge or connection check does not establish that an outstanding balance or restriction has cleared.")
    else:
        add("meta_billing_not_verified", "info", "Meta billing clearance is not verified by this page. Review the correct WABA's outstanding balance and account restrictions in Meta Billing & Payments before testing.")
    if codes & {131031, 368}:
        add("meta_account_restriction_recorded", "warning", "A recorded Meta failure reports an account restriction or verification issue. Review WhatsApp Manager and Meta account health; application switches cannot remove Meta restrictions.")
    phone_status = state.get("phoneCodeVerificationStatus")
    if phone_status == "NOT_VERIFIED":
        add("meta_phone_code_status_review", "info", "Meta reports the phone-number OTP ownership verification code as NOT_VERIFIED. Review it alongside the separate Cloud API status: CONNECTED is registered and usable, so this conflicting pair alone does not justify removal or re-registration. WABA business verification and health_status messaging eligibility are separate.")
    elif phone_status != "VERIFIED":
        add("meta_phone_code_status_unknown", "info", "The phone ownership OTP code status was not returned by the last connection check. This does not establish sender registration or business verification; review the separate sender status, WABA business verification and health_status fields.")
    subscription = state.get("subscriptionStatus")
    if subscription == "not_subscribed":
        add("meta_waba_not_subscribed", "warning", "The last connection check did not find this app subscribed to the configured WABA. Confirm the correct WABA/app subscription in Meta before testing; receipt notifications may otherwise be missing.")
    elif subscription != "subscribed":
        add("meta_waba_subscription_unknown", "info", "WABA/app subscription has not been confirmed. Run Test connection; a configured access token is not subscription evidence.")
    add("meta_messages_field_requires_verification", "info", "WABA app membership and the app's webhook field subscription are separate. Verify that messages is enabled on the active production callback. HTTP 200 means API acceptance; delivery and read require matching webhook receipts.")
    return rows


def error_description(code):
    return {
        190: "Meta access token is invalid or expired.",
        10: "Meta denied the required permission.",
        100: "Meta rejected a request parameter; inspect the template and recipient configuration.",
        130429: "Meta rate limit reached; delivery may be retried within the bounded retry policy.",
        131026: "Meta could not deliver this message to the recipient.",
        131031: "The WhatsApp Business account is restricted or locked.",
        131042: "Meta reported a business eligibility or payment issue.",
        131045: "Meta reported a phone-number registration error. Verify Cloud API registration for the configured sender.",
        133006: "Meta requires phone ownership verification before registration.",
        133010: "Meta reports that this sender is not registered on the WhatsApp Business Platform.",
        131047: "The customer service window is closed; an approved template is required.",
        132000: "The template parameter count does not match Meta's approved template.",
        132001: "Meta could not find the requested template name and language.",
        132015: "Meta has paused this template.",
        132016: "Meta has disabled this template.",
    }.get(code, "Meta reported a messaging failure. Review the error code in Meta's diagnostics.")
