"""Prepare an additive operator-reviewed mapping plan; never write configuration."""
from copy import deepcopy
from datetime import datetime, timezone
import json

from .whatsapp_definitions import definitions, definition_components
from .whatsapp_templates import components_match, component_signature, observation_is_stale
from .time_utils import as_utc_datetime

CANDIDATE_ORDER_MAPPINGS = {
    "order_placed": "order_received",
    "order_accepted": "order_and_payment_update",
    "order_rejected": "order_and_payment_update",
    "processing": "rk_processing",
    "packed": "rk_packed",
    "advance_payment_received": "order_and_payment_update",
    "part_payment_received": "order_and_payment_update",
    "payment_received": "order_and_payment_update",
}


def plan_order_template_mappings(db, config, *, enable_events=(), migrate_order_placed=False):
    """Verify raw scoped Meta contracts without granting cached approval.

    Unmapped observations deliberately lack a verified local signature. Compare
    their complete Meta components here to prepare a proposal, then require the
    normal post-deployment inventory refresh before registry/worker approval.
    Existing entries are preserved except for an explicitly requested migration
    of the superseded order_placed draft. New/replaced entries default disabled;
    explicit enabling cannot bypass evidence checks. This function never writes.
    """
    raw = config.get("WHATSAPP_TEMPLATES", "{}")
    if not isinstance(migrate_order_placed, bool):
        raise ValueError("migration_opt_in_must_be_boolean")
    existing = json.loads(raw) if isinstance(raw, str) else raw
    if not isinstance(existing, dict):
        raise ValueError("template_mappings_must_be_an_object")
    requested = set(enable_events)
    if requested - CANDIDATE_ORDER_MAPPINGS.keys():
        raise ValueError("unsupported_transactional_activation_event")
    merged = deepcopy(existing)
    catalogue = definitions(config)
    sync = (db.integrations.find_one({"_id": "whatsapp"}) or {}).get("templateStatusSync") or {}
    checks = []
    for event, name in CANDIDATE_ORDER_MAPPINGS.items():
        previous = existing.get(event)
        legacy = event == "order_placed" and isinstance(previous, dict) and (
            previous.get("name") == "rk_order_placed" or previous.get("catalogue") == "rk_order_placed")
        migrating = bool(legacy and migrate_order_placed)
        spec = catalogue[name]
        expected = definition_components(spec)
        observed = db.whatsapp_template_status.find_one({"_id": name + ":" + spec["language"]}) or {}
        reason = None
        if spec.get("activationBlock"):
            reason = spec["activationBlock"]
        elif legacy and not migrating:
            reason = "legacy_template_mapping_requires_migration"
        elif event in existing and not migrating:
            reason = "existing_mapping_preserved"
        elif not observed or observed.get("source") != "meta_api_read" or observed.get("presentInMeta") is not True:
            reason = "missing_meta_evidence"
        elif (not config.get("WHATSAPP_BUSINESS_ACCOUNT_ID")
              or observed.get("businessAccountId") != str(config["WHATSAPP_BUSINESS_ACCOUNT_ID"])
              or observation_is_stale(observed, sync, config["WHATSAPP_BUSINESS_ACCOUNT_ID"])
              or as_utc_datetime(observed.get("checkedAt")) > datetime.now(timezone.utc)):
            reason = "stale_or_wrong_account_evidence"
        elif (observed.get("name"), observed.get("language"), observed.get("category"), observed.get("status")) != (name, "en_US", "UTILITY", "APPROVED"):
            reason = "meta_identity_category_language_or_approval_mismatch"
        elif name == "order_received" and any(c.get("type") == "BODY" and str(c.get("text", "")).endswith("progresses.Hello")
                for c in (observed.get("metaComponents") or []) if isinstance(c, dict)):
            reason = "meta_body_correction_required"
        elif not components_match(expected, observed.get("metaComponents")):
            reason = "meta_component_contract_mismatch"
        if reason is None:
            merged[event] = {"catalogue": name, "name": name, "language": "en_US", "category": "UTILITY",
                             "parameters": list(spec["parameters"]), "parameterTypes": list(spec["parameterTypes"]), "enabled": event in requested}
        checks.append({"event": event, "name": name, "compatible": reason is None, "reason": reason,
                       "activationStatus": "BLOCKED" if spec.get("activationBlock") or (event == "order_placed" and reason is not None)
                           else "READY_AFTER_FRESH_META_VERIFICATION" if reason is None else "NOT_READY",
                       "migrationAppliedToProposal": bool(migrating and reason is None),
                       "operatorOptIn": event in requested,
                       "componentSignature": component_signature(expected), "parameters": list(spec["parameters"]),
                       "contentWarning": spec.get("contentWarning"),
                       "requiresInventoryRefreshBeforeDispatch": reason is None})
    return {"proposedMappings": merged, "checks": checks, "configurationWritten": False}
