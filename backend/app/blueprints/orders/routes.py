from datetime import datetime, timedelta, timezone
import re

from bson import ObjectId
from flask import Blueprint, current_app, jsonify, request

from ...order_fulfillment import (
    ACTIVE_FULFILLMENT_STATUSES,
    FULFILLMENT_STATUSES,
    PAYMENT_STATUSES,
    RETURN_FULFILLMENT_STATUSES,
    OrderTransitionConflict,
    OrderTransitionError,
    apply_transition,
    canonical_fulfillment_status,
    canonical_payment_status,
    ensure_order_indexes,
    ensure_order_tracking,
    migrate_legacy_orders,
    order_view,
    payment_confirmation_changes,
    update_shipment,
)
from ...order_confirmation import send_order_confirmation
from ...returns import create_return_request, return_url, send_return_accepted
from ...rbac import authenticated_user_id, current_user, database, requireCustomer, requirePermission
from ...whatsapp_orders import order_whatsapp_activity
from ...whatsapp_consent import order_consent_status, record_consent
from ...phone_numbers import customer_phone
from ...time_utils import json_value
from ...extensions import limiter


customer_orders_bp = Blueprint("customer_orders", __name__)
staff_orders_bp = Blueprint("staff_orders", __name__)


@customer_orders_bp.before_request
@limiter.limit("60 per minute")
def _customer_order_rate_guard():
    return None


@staff_orders_bp.before_request
@limiter.limit("300 per minute")
def _staff_order_rate_guard():
    return None


def _prepare(database_instance) -> None:
    ensure_order_indexes(database_instance)
    migrate_legacy_orders(database_instance)


def _staff_view(db, order):
    from ...notification_activity import expire_stale_email_claims
    expire_stale_email_claims(db, order["_id"])
    order = db.orders.find_one({"_id": order["_id"]}) or order
    view = order_view(order, include_private_payment=True)
    view["captureFulfillmentStatus"] = order.get("captureFulfillmentStatus")
    from ...inventory_operations import inventory_block_reason, operation_evidence, persisted_inventory_block_reason, capture_recoverable, manual_reservation_recoverable
    blocked = bool(persisted_inventory_block_reason(db, order))
    evidence = operation_evidence(db, order)
    reconcilable = capture_recoverable(evidence) if evidence["capture"] else manual_reservation_recoverable(evidence)
    view["inventoryReconciliation"] = {
        "blocked": blocked,
        "reason": inventory_block_reason(order) or ("inventory_operation_unresolved" if blocked else None),
        "captureFulfillmentStatus": order.get("captureFulfillmentStatus"),
        "operations": json_value(evidence),
        "markerReconciliationAvailable": reconcilable,
        "manualInvestigationRequired": bool(blocked and (evidence["capture"] or evidence["manual"]) and not reconcilable),
        "investigations": json_value(order.get("inventoryInvestigations", [])),
    }
    if blocked:
        view["availableActions"] = [action for action in view.get("availableActions", []) if action in {"cancelled", "refunded", "return_requested"}]
    view["whatsapp"] = json_value(order_whatsapp_activity(db, current_app.config, order))
    from ...notification_activity import staff_channel_activity
    view["notificationActivity"] = json_value(staff_channel_activity(db, order, view["whatsapp"]))
    for entry in view["timeline"]:
        event = {"confirmed": "order_accepted", "refunded": "refund_completed"}.get(entry["status"], entry["status"])
        entry["notificationOutcomes"] = [row for row in view["notificationActivity"] if row["event"] == event]
        metadata = entry.get("metadata") or {}
        reference = metadata.get("transactionId") or metadata.get("refundId")
        if reference:
            entry["notificationOutcomes"] = [row for row in entry["notificationOutcomes"]
                if row.get("reference") == reference or row.get("notificationKey") in {"payment:" + reference, "refund:" + reference}]
    return view


def _customer_view(db, order):
    view = order_view(order)
    from ...inventory_operations import persisted_inventory_block_reason
    if not persisted_inventory_block_reason(db, order):
        return view
    successful = {"confirmed", "order_accepted", "processing", "packed", "shipped", "out_for_delivery", "delivered"}
    actual = canonical_fulfillment_status(order)
    if actual in successful:
        view["fulfillmentStatus"] = "order_placed"
        view["fulfillment"]["status"] = "order_placed"
        view["timeline"] = [event for event in view.get("timeline", []) if event.get("status") not in successful]
        view["latestStatus"] = view["timeline"][-1] if view["timeline"] else None
        view["customerNotice"] = "Your payment is recorded. Our team is confirming order availability before fulfilment proceeds."
    return view


def _object_id(value: str):
    return ObjectId(value) if ObjectId.is_valid(value) else None


def _safe_regex(value: object, maximum: int = 100):
    text = str(value or "").strip()[:maximum]
    return {"$regex": re.escape(text), "$options": "i"} if text else None


def _parse_date(value: str, end_of_day: bool = False):
    try:
        parsed = datetime.strptime(value, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return None
    return parsed + timedelta(days=1) - timedelta(microseconds=1) if end_of_day else parsed


def _customer_order_query(user_id: ObjectId) -> dict:
    query: dict = {"customerId": user_id}
    scope = str(request.args.get("scope") or "all").strip().lower()
    if scope == "active":
        query["fulfillment.status"] = {"$in": list(ACTIVE_FULFILLMENT_STATUSES)}
    elif scope == "past":
        query["fulfillment.status"] = {"$in": ["delivered", "cancelled", "returned", "refunded"]}
    search = _safe_regex(request.args.get("q"))
    if search:
        query["orderNumber"] = search
    return query


def _staff_order_query() -> tuple[dict, str | None]:
    query: dict = {}
    payment = str(request.args.get("payment") or "all").strip().lower()
    fulfillment = str(request.args.get("fulfillment") or "all").strip().lower()
    courier = str(request.args.get("courier") or "all").strip()
    period = str(request.args.get("date") or "all").strip().lower()
    if payment != "all":
        if payment not in PAYMENT_STATUSES:
            return {}, "Choose a valid payment filter."
        if payment in {"pending", "partial", "overdue"}:
            query["$paymentCollectionFilter"] = payment
        else:
            query["payment.status"] = payment
    if fulfillment != "all":
        if fulfillment == "returns":
            query["fulfillment.status"] = {"$in": list(RETURN_FULFILLMENT_STATUSES)}
        elif fulfillment not in FULFILLMENT_STATUSES:
            return {}, "Choose a valid fulfillment filter."
        else:
            query["fulfillment.status"] = fulfillment
    if courier.lower() != "all":
        courier_filter = _safe_regex(courier, 100)
        if courier_filter:
            courier_filter["$regex"] = f"^{courier_filter['$regex']}$"
            query["fulfillment.courier"] = courier_filter
    now = datetime.now(timezone.utc)
    if period in {"today", "7d", "30d"}:
        days = {"today": 1, "7d": 7, "30d": 30}[period]
        query["createdAt"] = {"$gte": (now - timedelta(days=days - 1)).replace(hour=0, minute=0, second=0, microsecond=0)}
    elif period == "custom":
        start = _parse_date(str(request.args.get("from") or ""))
        end = _parse_date(str(request.args.get("to") or ""), end_of_day=True)
        if not start or not end or start > end:
            return {}, "Choose a valid custom date range."
        query["createdAt"] = {"$gte": start, "$lte": end}
    elif period != "all":
        return {}, "Choose a valid date filter."
    search = _safe_regex(request.args.get("q"))
    if search:
        query["$or"] = [
            {"orderNumber": search}, {"customerName": search}, {"email": search},
            {"fulfillment.trackingNumber": search},
        ]
    return query, None


def _configured_couriers(database_instance) -> list[str]:
    settings = database_instance.admin_settings.find_one({"_id": "store"}) or {}
    options = settings.get("courierOptions")
    configured = [str(option).strip()[:100] for option in options if str(option).strip()] if isinstance(options, list) else []
    existing = [str(option).strip()[:100] for option in database_instance.orders.distinct("fulfillment.courier") if str(option).strip()]
    result = []
    for courier in [*configured, *existing]:
        if courier.lower() not in {value.lower() for value in result}:
            result.append(courier)
    return result[:30]


def _order_counts(database_instance) -> dict:
    payment_counts = {status: 0 for status in PAYMENT_STATUSES}
    for order in database_instance.orders.find({}, {"payment": 1, "paymentStatus": 1, "paymentGateway": 1, "total": 1, "paymentTransactions": 1, "paymentDueAt": 1}):
        status = canonical_payment_status(order)
        payment_counts[status] = payment_counts.get(status, 0) + 1
    fulfillment_counts = {
        status: database_instance.orders.count_documents({"$or": [{"fulfillment.status": status}, {"fulfillmentStatus": status}, {"status": status}]})
        for status in FULFILLMENT_STATUSES
    }
    fulfillment_counts["returns"] = sum(fulfillment_counts.get(status, 0) for status in RETURN_FULFILLMENT_STATUSES)
    return {"payment": payment_counts, "fulfillment": fulfillment_counts}


@customer_orders_bp.get("")
@requireCustomer
def list_customer_orders():
    db = database()
    _prepare(db)
    user_id = authenticated_user_id()
    orders = list(db.orders.find(_customer_order_query(user_id)).sort("createdAt", -1).limit(100))
    views = [_customer_view(db, ensure_order_tracking(db, order)) for order in orders]
    active = db.orders.count_documents({"customerId": user_id, "fulfillment.status": {"$in": list(ACTIVE_FULFILLMENT_STATUSES)}})
    past = db.orders.count_documents({"customerId": user_id, "fulfillment.status": {"$in": ["delivered", "cancelled", "return_requested", "returned", "refunded"]}})
    total = db.orders.count_documents({"customerId": user_id})
    return jsonify({"orders": views, "counts": {"active": active, "past": past, "all": total}}), 200


@customer_orders_bp.get("/<order_id>")
@requireCustomer
def get_customer_order(order_id: str):
    object_id = _object_id(order_id)
    if not object_id:
        return jsonify({"error": "Order not found."}), 404
    db = database()
    _prepare(db)
    order = db.orders.find_one({"_id": object_id, "customerId": authenticated_user_id()})
    if not order:
        return jsonify({"error": "Order not found."}), 404
    view = _customer_view(db, ensure_order_tracking(db, order))
    view["whatsappUpdates"] = order_consent_status(db, current_app.config, current_user(), order)
    return jsonify({"order": view}), 200


@customer_orders_bp.post("/<order_id>/whatsapp-consent")
@requireCustomer
@limiter.limit("5 per minute")
def grant_order_whatsapp_consent(order_id: str):
    object_id = _object_id(order_id)
    if not object_id:
        return jsonify(error="Order not found."), 404
    payload = request.get_json(silent=True) or {}
    if payload.get("whatsappTransactionalConsent") is not True:
        return jsonify(error="Explicit transactional WhatsApp consent is required.", code="whatsapp_consent_required"), 400
    db = database()
    user = current_user()
    order = db.orders.find_one({"_id": object_id, "customerId": user["_id"]})
    if not order:
        return jsonify(error="Order not found."), 404
    candidate = payload.get("whatsappRecipient", order.get("whatsappRecipient") or user.get("whatsappPhone") or user.get("phone"))
    try:
        phone, country = customer_phone(candidate, payload.get("whatsappCountry"))
    except ValueError:
        return jsonify(error="Enter a valid WhatsApp number with its country code.", code="whatsapp_number_invalid"), 400
    previous = order.get("whatsappConsent")
    consent = record_consent(db, current_app.config, user["_id"], phone, True, "order_reconsent", order_id=object_id, update_user=False)
    update = {"$set": {"whatsappRecipient": phone, "whatsappCountry": country,
                       "whatsappRecipientSource": "post_order", "whatsappConsent": consent}}
    if isinstance(previous, dict) and previous.get("enabled") is False:
        update["$push"] = {"whatsappConsentHistory": previous}
    db.orders.update_one({"_id": object_id, "customerId": user["_id"]}, update)
    updated = db.orders.find_one({"_id": object_id, "customerId": user["_id"]})
    view = _customer_view(db, updated)
    view["whatsappUpdates"] = order_consent_status(db, current_app.config, user, updated)
    return jsonify(order=view), 200


@customer_orders_bp.post("/<order_id>/return-request")
@requireCustomer
def request_order_return(order_id: str):
    object_id = _object_id(order_id)
    if not object_id:
        return jsonify({"error": "Order not found."}), 404
    db = database()
    _prepare(db)
    user = current_user()
    order = db.orders.find_one({"_id": object_id, "customerId": user["_id"]})
    if not order:
        return jsonify({"error": "Order not found."}), 404
    payload = request.get_json(silent=True) or {}
    reason = str(payload.get("reason") or "").strip()
    if not reason:
        return jsonify({"error": "Enter a reason for the return request."}), 400
    try:
        updated = apply_transition(db, order, "return_requested", "customer", user, {"internalNote": reason, "customerNote": reason, "sendCustomerNotification": False})
    except OrderTransitionError as error:
        return jsonify({"error": str(error), "code": error.code}), 400
    except OrderTransitionConflict as error:
        return jsonify({"error": str(error)}), 409
    db.orders.update_one({"_id": updated["_id"]}, {"$set": {"returnRequest": {"status": "requested", "reason": reason, "requestedAt": datetime.now(timezone.utc)}}})
    return jsonify({"order": _customer_view(db, db.orders.find_one({"_id": updated["_id"]}))}), 200


@staff_orders_bp.get("")
@requirePermission("orders:manage")
def list_staff_orders():
    db = database()
    _prepare(db)
    query, error = _staff_order_query()
    if error:
        return jsonify({"error": error}), 400
    collection_filter = query.pop("$paymentCollectionFilter", None)
    orders = db.orders.find(query).sort("createdAt", -1)
    if collection_filter:
        orders = [order for order in orders if canonical_payment_status(order) == collection_filter][:200]
    else:
        orders = orders.limit(200)
    return jsonify({
        "orders": [_staff_view(db, ensure_order_tracking(db, order)) for order in orders],
        "counts": _order_counts(db),
        "courierOptions": _configured_couriers(db),
    }), 200


@staff_orders_bp.get("/summary")
@requirePermission("orders:manage")
def staff_order_summary():
    db = database()
    _prepare(db)
    return jsonify({"counts": _order_counts(db)}), 200


@staff_orders_bp.get("/<order_id>")
@requirePermission("orders:manage")
def get_staff_order(order_id: str):
    object_id = _object_id(order_id)
    if not object_id:
        return jsonify({"error": "Order not found."}), 404
    db = database()
    _prepare(db)
    order = db.orders.find_one({"_id": object_id})
    if not order:
        return jsonify({"error": "Order not found."}), 404
    return jsonify({
        "order": _staff_view(db, ensure_order_tracking(db, order)),
        "courierOptions": _configured_couriers(db),
    }), 200


@staff_orders_bp.get("/<order_id>/inventory-reconciliation")
@requirePermission("inventory:manage")
def get_inventory_reconciliation(order_id: str):
    object_id = _object_id(order_id)
    if not object_id:
        return jsonify({"error": "Order not found."}), 404
    db = database()
    order = db.orders.find_one({"_id": object_id})
    if not order:
        return jsonify({"error": "Order not found."}), 404
    from ...inventory_operations import operation_evidence, capture_recoverable, manual_reservation_recoverable, persisted_inventory_block_reason
    evidence = operation_evidence(db, order)
    recoverable = capture_recoverable(evidence) if evidence["capture"] else manual_reservation_recoverable(evidence)
    return jsonify({"blocked": bool(persisted_inventory_block_reason(db, order)),
                    "evidence": json_value(evidence), "markerReconciliationAvailable": recoverable,
                    "manualInvestigationRequired": bool((evidence["capture"] or evidence["manual"]) and not recoverable)}), 200


@staff_orders_bp.post("/<order_id>/inventory-reconciliation")
@requirePermission("inventory:manage")
def reconcile_inventory_operations(order_id: str):
    object_id = _object_id(order_id)
    if not object_id:
        return jsonify({"error": "Order not found."}), 404
    db = database()
    order = db.orders.find_one({"_id": object_id})
    if not order:
        return jsonify({"error": "Order not found."}), 404
    payload = request.get_json(silent=True) or {}
    reason = str(payload.get("reason") or "").strip()[:500]
    if payload.get("action") != "reconcile_product_markers" or len(reason) < 8:
        return jsonify({"error": "Choose marker reconciliation and provide a reason of at least 8 characters.", "code": "reconciliation_input_required"}), 400
    from ...inventory_operations import operation_evidence, capture_recoverable, manual_reservation_recoverable
    actor = current_user() or {}
    before = operation_evidence(db, order)
    audit = {"actorId": str(actor.get("_id") or ""), "actorName": str(actor.get("name") or actor.get("email") or "Staff")[:120],
             "at": datetime.now(timezone.utc), "reason": reason, "action": "reconcile_product_markers",
             "operationIds": [r["operationId"] for r in before["capture"] + before["manual"]], "before": before}
    if before["capture"]:
        if canonical_fulfillment_status(order) not in {"order_placed", "awaiting_confirmation"}:
            return jsonify(error="Only an open, unconfirmed order can complete capture recovery.", code="capture_lifecycle_ineligible"), 409
        if not capture_recoverable(before) or order.get("captureFulfillmentStatus") not in {"held", "processing", "unresolved"}:
            return jsonify({"error": "Product markers do not prove every capture adjustment. Manual investigation is required; the order remains blocked.", "code": "inventory_evidence_ambiguous"}), 409
        payment_id = order.get("razorpayPaymentId") or (order.get("payment") or {}).get("razorpayPaymentId")
        token = order.get("captureClaimToken")
        capture = order.get("captureEvidence") or {}
        if (not payment_id or not token or order.get("refunds")
                or order.get("paymentStatus") in {"refunded", "partially_refunded"}
                or (order.get("payment") or {}).get("status") in {"refunded", "partially_refunded"}
                or not order.get("paymentVerifiedAt") or capture.get("paymentId") != payment_id
                or capture.get("status") != "captured" or capture.get("currency") != order.get("currency", "INR")
                or not isinstance(capture.get("amountPaise"), int) or isinstance(capture.get("amountPaise"), bool)
                or capture.get("amountPaise", 0) <= 0 or capture.get("amountPaise") != order.get("amountPaise")):
            return jsonify({"error": "Capture identity or payment state is inconsistent. Manual investigation is required.", "code": "capture_state_inconsistent"}), 409
        from ...inventory_operations import capture_operation_id, reconcile_capture_ledger_from_product
        reconcile_capture_ledger_from_product(db, order["_id"])
        for index, item in enumerate(order.get("items", [])):
            op_id = capture_operation_id(order["_id"], payment_id, index)
            result = db.inventory_operations.update_one(
                {"_id": op_id, "orderId": str(order["_id"]), "captureId": str(payment_id), "claimToken": token,
                 "state": {"$in": ["planned", "applying", "unresolved", "applied"]}},
                {"$set": {"state": "applied", "productMarkerObserved": True, "reconciledAt": datetime.now(timezone.utc), "updatedAt": datetime.now(timezone.utc)}},
            )
            if result.matched_count != 1:
                return jsonify({"error": "The operation ledger is inconsistent. The order remains blocked for manual investigation.", "code": "inventory_ledger_inconsistent"}), 409
        now = datetime.now(timezone.utc)
        fields, events = payment_confirmation_changes(order, str(payment_id), str((order.get("captureEvidence") or {}).get("source") or "staff_reconciliation"), "", now)
        audit["after"] = {"captureFulfillmentStatus": "completed", "paymentStatus": "paid", "operations": before["capture"]}
        query = {"_id": object_id, "captureClaimToken": token, "captureFulfillmentStatus": order.get("captureFulfillmentStatus"),
                 "fulfillment": order.get("fulfillment"), "payment": order.get("payment"), "refunds": order.get("refunds", {"$exists": False})}
        # payment_confirmation_changes already merges the saved payment fields
        # and sets payment.status to paid. Keep that single parent update under
        # the payment snapshot fence; a dotted child update would conflict.
        fields.update({"captureFulfillmentStatus": "completed", "paymentStatus": "paid", "updatedAt": now})
        updated = db.orders.find_one_and_update(query, {"$set": fields, "$push": {"timeline": {"$each": events}, "inventoryRecoveryAudit": audit}}, return_document=__import__("pymongo").ReturnDocument.AFTER)
        if not updated:
            return jsonify({"error": "The order changed during reconciliation. Refresh and inspect evidence; it remains blocked unless already completed.", "code": "inventory_reconciliation_conflict"}), 409
        from ...order_confirmation import send_order_confirmation
        send_order_confirmation(db, updated, current_app.config, current_app.logger)
        return jsonify({"order": _staff_view(db, updated), "message": "Capture inventory markers were verified and the capture was reconciled."}), 200
    if before["manual"]:
        if order.get("inventoryReservation") not in {"reserving", "unresolved"} or not manual_reservation_recoverable(before):
            return jsonify({"error": "Manual reservation markers do not prove every required item. Manual investigation is required; the order remains blocked.", "code": "inventory_evidence_ambiguous"}), 409
        audit["after"] = {"inventoryReservation": "reserved", "operations": before["manual"]}
        changed = db.orders.update_one({"_id": object_id, "inventoryReservation": order.get("inventoryReservation"),
            "inventoryReservationClaimToken": order.get("inventoryReservationClaimToken"), "fulfillment": order.get("fulfillment")},
            {"$set": {"inventoryReservation": "reserved",
                       "inventoryReservationReconciledAt": datetime.now(timezone.utc)}, "$push": {"inventoryRecoveryAudit": audit}})
        if changed.modified_count != 1:
            return jsonify({"error": "The order changed during reconciliation. Refresh and inspect evidence.", "code": "inventory_reconciliation_conflict"}), 409
        return jsonify({"order": _staff_view(db, db.orders.find_one({"_id": object_id})), "message": "Manual reservation markers were verified. Staff may now retry the explicit acceptance transition."}), 200
    return jsonify({"error": "No interrupted inventory operation is eligible for marker reconciliation.", "code": "no_reconciliation_required"}), 409


@staff_orders_bp.post("/<order_id>/inventory-investigations")
@requirePermission("inventory:manage")
def record_inventory_investigation(order_id):
    from ...inventory_operations import operation_evidence
    from uuid import uuid4
    object_id = _object_id(order_id)
    db = database()
    order = db.orders.find_one({"_id": object_id}) if object_id else None
    if not order:
        return jsonify(error="Order not found."), 404
    payload = request.get_json(silent=True) or {}
    evidence = operation_evidence(db, order)
    rows = evidence["capture"] + evidence["manual"]
    operation = next((row for row in rows if row["operationId"] == payload.get("operationId")), None)
    if (not operation or payload.get("productId") != operation["productId"]
            or isinstance(payload.get("itemIndex"), bool) or not isinstance(payload.get("itemIndex"), int)
            or payload.get("itemIndex") != operation["itemIndex"]):
        return jsonify(error="Choose an operation belonging to this order and item."), 400
    texts = {key: payload.get(key, "") for key in ("reason", "findings", "evidenceReference")}
    if any(not isinstance(value, str) for value in texts.values()):
        return jsonify(error="Investigation fields must be text."), 400
    texts = {key: value.strip() for key, value in texts.items()}
    if not 8 <= len(texts["reason"]) <= 500 or not 8 <= len(texts["findings"]) <= 1500 or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{2,119}", texts["evidenceReference"]):
        return jsonify(error="Provide a reason, warehouse findings and an internal evidence document identifier."), 400
    if re.search(r"mongodb(?:\+srv)?://|PRIVATE KEY|[\w.+-]+@[\w.-]+|\+?\d[\d -]{8,}\d", texts["reason"] + " " + texts["findings"], re.I):
        return jsonify(error="Record inventory facts only; omit credentials and personal contact details."), 400
    outcome, follow_up = payload.get("outcome"), payload.get("followUpStatus")
    if outcome not in {"unresolved", "evidence_collected", "escalated"} or follow_up not in {"awaiting_warehouse", "awaiting_administrator", "under_review"}:
        return jsonify(error="Choose a supported investigation outcome and follow-up status."), 400
    count = payload.get("externalStockCount")
    if isinstance(count, bool) or not isinstance(count, int) or not 0 <= count <= 1_000_000_000:
        return jsonify(error="Provide a nonnegative integer warehouse count."), 400
    prior_id = payload.get("supersedesId")
    if prior_id and not any(row.get("id") == prior_id and row.get("operationId") == operation["operationId"] for row in order.get("inventoryInvestigations", [])):
        return jsonify(error="The correction must reference this order's original operation investigation."), 400
    actor = current_user() or {}
    entry = {"id": uuid4().hex, "orderId": str(object_id), "operationId": operation["operationId"],
             "productId": operation["productId"], "itemIndex": operation["itemIndex"],
             "recordedAt": datetime.now(timezone.utc), "actorId": str(actor.get("_id")),
             **texts, "externalStockCount": count, "outcome": outcome, "followUpStatus": follow_up,
             "unresolved": True, "supersedesId": prior_id or None}
    query = {"_id": object_id, "items": order.get("items"),
             "captureClaimToken": order.get("captureClaimToken"),
             "inventoryReservationClaimToken": order.get("inventoryReservationClaimToken")}
    if prior_id:
        query["inventoryInvestigations.id"] = prior_id
    if db.orders.update_one(query, {"$push": {"inventoryInvestigations": entry}}).modified_count != 1:
        return jsonify(error="The operation changed. Refresh before recording findings."), 409
    return jsonify(investigation=json_value(entry), order=_staff_view(db, db.orders.find_one({"_id": object_id}))), 201


@staff_orders_bp.post("/<order_id>/confirmation-email")
@requirePermission("orders:manage")
def resend_confirmation_email(order_id: str):
    object_id = _object_id(order_id)
    if not object_id:
        return jsonify({"error": "Order not found."}), 404
    db = database()
    order = db.orders.find_one({"_id": object_id})
    if not order:
        return jsonify({"error": "Order not found."}), 404
    if canonical_payment_status(order) != "paid" and order.get("paymentGateway") != "manual":
        return jsonify({"error": "Confirmation can only be sent after payment is verified."}), 400
    sent = send_order_confirmation(db, order, current_app.config, current_app.logger, force=True)
    updated = db.orders.find_one({"_id": object_id}) or order
    status_code = 200 if sent else 502
    return jsonify({
        "order": _staff_view(db, updated),
        "message": "Order email sent." if sent else "The saved order is unchanged, but email delivery failed and can be retried.",
    }), status_code


@staff_orders_bp.patch("/<order_id>/fulfillment")
@requirePermission("orders:manage")
def change_fulfillment(order_id: str):
    object_id = _object_id(order_id)
    if not object_id:
        return jsonify({"error": "Order not found."}), 404
    db = database()
    order = db.orders.find_one({"_id": object_id})
    if not order:
        return jsonify({"error": "Order not found."}), 404
    payload = request.get_json(silent=True) or {}
    target = str(payload.get("status") or "")
    try:
        updated = apply_transition(db, order, target, "staff", current_user(), payload)
    except OrderTransitionError as error:
        return jsonify({"error": str(error), "code": error.code}), 400
    except OrderTransitionConflict as error:
        return jsonify({"error": str(error)}), 409
    return jsonify({"order": _staff_view(db, updated)}), 200


@staff_orders_bp.patch("/<order_id>/shipment")
@requirePermission("orders:manage")
def edit_shipment(order_id: str):
    object_id = _object_id(order_id)
    if not object_id:
        return jsonify({"error": "Order not found."}), 404
    db = database()
    _prepare(db)
    order = db.orders.find_one({"_id": object_id})
    if not order:
        return jsonify({"error": "Order not found."}), 404
    try:
        updated = update_shipment(db, order, current_user(), request.get_json(silent=True) or {})
    except OrderTransitionError as error:
        return jsonify({"error": str(error)}), 400
    except OrderTransitionConflict as error:
        return jsonify({"error": str(error)}), 409
    return jsonify({"order": _staff_view(db, updated)}), 200


@staff_orders_bp.patch("/<order_id>/return")
@requirePermission("orders:manage")
def accept_return(order_id: str):
    object_id = _object_id(order_id)
    if not object_id:
        return jsonify({"error": "Order not found."}), 404
    db = database()
    _prepare(db)
    order = db.orders.find_one({"_id": object_id})
    if not order:
        return jsonify({"error": "Order not found."}), 404
    if canonical_fulfillment_status(order) != "return_requested":
        return jsonify({"error": "Only requested returns can be accepted."}), 400
    payload = request.get_json(silent=True) or {}
    customer_note = str(payload.get("customerNote") or "").strip()[:500]
    record, token = create_return_request(db, order, str((order.get("returnRequest") or {}).get("reason") or ""), current_user())
    now = datetime.now(timezone.utc)
    db.orders.update_one({"_id": object_id}, {"$set": {"returnRequest": {"status": "accepted", "reason": (order.get("returnRequest") or {}).get("reason", ""), "requestedAt": (order.get("returnRequest") or {}).get("requestedAt"), "acceptedAt": now, "tokenHash": record.get("tokenHash"), "formUrl": return_url(token)}}})
    updated = db.orders.find_one({"_id": object_id})
    try:
        if payload.get("sendCustomerNotification", True) is not False:
            send_return_accepted(db, updated, token, customer_note)
    except Exception:
        current_app.logger.exception("Unable to send return acceptance notification")
    return jsonify({"order": _staff_view(db, updated), "returnFormUrl": return_url(token)}), 200


@staff_orders_bp.post("/<order_id>/payments")
@requirePermission("orders:manage")
def collect_payment(order_id):
    object_id = _object_id(order_id)
    db = database()
    order = db.orders.find_one({"_id": object_id}) if object_id else None
    if not order:
        return jsonify(error="Order not found."), 404
    from ...manual_payments import record_payment
    try:
        updated = record_payment(db, order, current_user(), request.get_json(silent=True) or {})
    except ValueError as error:
        return jsonify(error=str(error)), 400
    return jsonify(order=_staff_view(db, updated)), 200


@staff_orders_bp.patch("/<order_id>/payment-instructions")
@requirePermission("orders:manage")
def payment_instructions(order_id):
    from ...manual_payments import is_manual, parse_due
    from ...time_utils import as_utc_datetime
    from ...order_fulfillment import actor_view, timeline_event
    db = database()
    object_id = _object_id(order_id)
    order = db.orders.find_one({"_id": object_id}) if object_id else None
    if not order:
        return jsonify(error="Order not found."), 404
    if not is_manual(order):
        return jsonify(error="Manual payment instructions cannot change Razorpay records."), 400
    payload = request.get_json(silent=True) or {}
    text = payload.get("instructions", "")
    raw = payload.get("dueAt")
    try:
        due = parse_due(raw)
    except ValueError as error:
        return jsonify(error=str(error)), 400
    if not isinstance(text, str) or len(text) > 1000 or (raw and not due):
        return jsonify(error="Enter valid instructions and payment due date."), 400
    now = datetime.now(timezone.utc)
    from pymongo import ReturnDocument
    updated = db.orders.find_one_and_update({"_id": object_id}, {
        "$set": {"paymentInstructions": text.strip(), "paymentDueAt": due, "updatedAt": now},
        "$push": {"timeline": timeline_event("payment_terms_updated", now, actor_view("staff", current_user()), "Payment instructions and due date updated.", {"dueAt": due})}},
        return_document=ReturnDocument.AFTER)
    return jsonify(order=_staff_view(db, updated)), 200


@staff_orders_bp.post("/<order_id>/payments/reversal")
@requirePermission("orders:manage")
def correct_payment(order_id):
    from ...manual_payments import reverse_payment
    db = database()
    object_id = _object_id(order_id)
    order = db.orders.find_one({"_id": object_id}) if object_id else None
    if not order:
        return jsonify(error="Order not found."), 404
    try:
        updated = reverse_payment(db, order, current_user(), request.get_json(silent=True) or {})
    except ValueError as error:
        return jsonify(error=str(error)), 400
    return jsonify(order=_staff_view(db, updated)), 200


@staff_orders_bp.post("/<order_id>/notifications/retry")
@requirePermission("orders:manage")
def retry_order_notification(order_id):
    from ...whatsapp_orders import ORDER_NOTIFICATIONS, notify_order_whatsapp
    from ...whatsapp_events import event_values
    from ...order_fulfillment import send_status_notification
    from ...notification_activity import notification_key
    db = database()
    object_id = _object_id(order_id)
    order = db.orders.find_one({"_id": object_id}) if object_id else None
    if not order:
        return jsonify(error="Order not found."), 404
    payload = request.get_json(silent=True) or {}
    event, transaction = payload.get("event"), payload.get("transactionId")
    if not isinstance(event, str) or event not in ORDER_NOTIFICATIONS:
        return jsonify(error="Choose a valid order notification event."), 400
    channel = payload.get("channel", "all")
    if not isinstance(channel, str) or channel not in {"all", "whatsapp"}:
        return jsonify(error="Choose a valid notification channel."), 400
    if transaction:
        order["whatsappPayment"] = next((t for t in order.get("paymentTransactions", []) if t.get("id") == transaction), {})
    try:
        event_values(event, order)
    except (ValueError, KeyError) as exc:
        # Only fixed internal codes may leave this staff-only endpoint. Never
        # expose arbitrary exception text, saved values or recipient details.
        reasons = {
            "cancellation_state_not_recorded": "The current order is not cancelled.",
            "cancellation_reference_missing": "A persisted cancellation timeline ID is required.",
            "rejection_not_recorded": "The persisted rejection decision is missing.",
            "rejection_reason_not_recorded": "The persisted rejection reason is missing or invalid.",
            "invalid_rejection_explanation": "The persisted rejection explanation is invalid.",
            "rejection_explanation_not_recorded": "The persisted rejection explanation is required.",
        }
        reason = str(exc) if isinstance(exc, ValueError) and str(exc) in reasons else "business_event_not_confirmed"
        return jsonify(error=reasons.get(reason, "The persisted event is no longer eligible for notification."), reason=reason), 409
    if channel == "whatsapp":
        notify_order_whatsapp(db, object_id, event, {"transactionId": transaction})
        return jsonify(order=_staff_view(db, db.orders.find_one({"_id": object_id}))), 200
    if event in {"order_placed", "order_confirmation"}:
        send_order_confirmation(db, order, current_app.config, current_app.logger)
    else:
        send_status_notification(db, order, event, notification_key=notification_key(event, "payment:" + transaction if transaction else None))
    notify_order_whatsapp(db, object_id, event, {"transactionId": transaction})
    return jsonify(order=_staff_view(db, db.orders.find_one({"_id": object_id}))), 200
