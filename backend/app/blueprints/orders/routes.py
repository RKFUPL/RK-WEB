from datetime import datetime, timedelta, timezone
import re

from bson import ObjectId
from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity

from ...order_fulfillment import (
    ACTIVE_FULFILLMENT_STATUSES,
    FULFILLMENT_STATUSES,
    PAYMENT_STATUSES,
    OrderTransitionConflict,
    OrderTransitionError,
    apply_transition,
    canonical_fulfillment_status,
    canonical_payment_status,
    ensure_order_indexes,
    ensure_order_tracking,
    migrate_legacy_orders,
    order_view,
    update_shipment,
)
from ...rbac import current_user, database, requireCustomer, requirePermission


customer_orders_bp = Blueprint("customer_orders", __name__)
staff_orders_bp = Blueprint("staff_orders", __name__)


def _prepare(database_instance) -> None:
    ensure_order_indexes(database_instance)
    migrate_legacy_orders(database_instance)


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
        query["payment.status"] = payment
    if fulfillment != "all":
        if fulfillment not in FULFILLMENT_STATUSES:
            return {}, "Choose a valid fulfillment filter."
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
    return {
        "payment": {status: database_instance.orders.count_documents({"payment.status": status}) for status in PAYMENT_STATUSES},
        "fulfillment": {status: database_instance.orders.count_documents({"fulfillment.status": status}) for status in FULFILLMENT_STATUSES},
    }


@customer_orders_bp.get("")
@requireCustomer
def list_customer_orders():
    db = database()
    _prepare(db)
    user_id = ObjectId(get_jwt_identity())
    orders = list(db.orders.find(_customer_order_query(user_id)).sort("createdAt", -1).limit(100))
    views = [order_view(ensure_order_tracking(db, order)) for order in orders]
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
    order = db.orders.find_one({"_id": object_id, "customerId": ObjectId(get_jwt_identity())})
    if not order:
        return jsonify({"error": "Order not found."}), 404
    return jsonify({"order": order_view(ensure_order_tracking(db, order))}), 200


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
        updated = apply_transition(db, order, "return_requested", "customer", user, {"note": reason})
    except OrderTransitionError as error:
        return jsonify({"error": str(error)}), 400
    except OrderTransitionConflict as error:
        return jsonify({"error": str(error)}), 409
    return jsonify({"order": order_view(updated)}), 200


@staff_orders_bp.get("")
@requirePermission("orders:manage")
def list_staff_orders():
    db = database()
    _prepare(db)
    query, error = _staff_order_query()
    if error:
        return jsonify({"error": error}), 400
    orders = db.orders.find(query).sort("createdAt", -1).limit(200)
    return jsonify({
        "orders": [order_view(ensure_order_tracking(db, order), include_private_payment=True) for order in orders],
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
        "order": order_view(ensure_order_tracking(db, order), include_private_payment=True),
        "courierOptions": _configured_couriers(db),
    }), 200


@staff_orders_bp.patch("/<order_id>/fulfillment")
@requirePermission("orders:manage")
def change_fulfillment(order_id: str):
    object_id = _object_id(order_id)
    if not object_id:
        return jsonify({"error": "Order not found."}), 404
    db = database()
    _prepare(db)
    order = db.orders.find_one({"_id": object_id})
    if not order:
        return jsonify({"error": "Order not found."}), 404
    payload = request.get_json(silent=True) or {}
    target = str(payload.get("status") or "")
    try:
        updated = apply_transition(db, order, target, "staff", current_user(), payload)
    except OrderTransitionError as error:
        return jsonify({"error": str(error)}), 400
    except OrderTransitionConflict as error:
        return jsonify({"error": str(error)}), 409
    return jsonify({"order": order_view(updated, include_private_payment=True)}), 200


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
    return jsonify({"order": order_view(updated, include_private_payment=True)}), 200
