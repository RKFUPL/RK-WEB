"""Idempotent stock reservation for manual acceptance, with compensating rollback.

Every product mutation includes its reservation marker in the same atomic write.
An interrupted acceptance stays locked for staff reconciliation, never retried blindly.
"""
from copy import deepcopy
from datetime import datetime, timezone
from secrets import token_hex
from bson import ObjectId
from pymongo import ReturnDocument


class ReservationAttempt(list):
    """Carry compensation ownership independently of later order snapshots."""
    def __init__(self, items=(), *, claim_token, owned=True):
        super().__init__(items)
        self.claim_token = claim_token
        self.owned = owned


def change_reservation(db, order, item, index, release=False, claim_token=None):
    if not claim_token:
        raise ValueError("An explicit reservation claim is required.")
    marker = f"{order['_id']}:{index}"
    from .inventory_operations import manual_operation_id
    operation_id = manual_operation_id(order["_id"], index, claim_token or "")
    product_id = ObjectId(item["productId"])
    for _ in range(5):
        product = db.products.find_one({"_id": product_id})
        if not product:
            raise ValueError("A selected product is no longer available.")
        markers = product.get("manualReservations", [])
        operation_markers = product.get("inventoryOperationMarkers", [])
        matching = [entry for entry in operation_markers if entry.get("operationId") == operation_id]
        if len(matching) > 1 or markers.count(marker) > 1:
            raise ValueError("Reservation evidence is ambiguous; investigation is required.")
        prior_operation = matching[0] if matching else None
        if not release and marker in markers:
            # Tell the acceptance saga whether this attempt actually changed
            # inventory. A pre-existing marker belongs to an earlier attempt
            # and must never be released by this attempt's compensation.
            return False
        if release and (marker not in markers or not prior_operation or prior_operation.get("state") != "reserved"
                        or not claim_token or prior_operation.get("claimToken") != claim_token):
            return False
        if release and any(prior_operation.get(key) != value for key, value in {
                "orderId": str(order["_id"]), "itemIndex": index, "productId": str(product_id),
                "quantity": item.get("quantity"), "stockDelta": -int(item.get("quantity") or 0),
                "variantId": item.get("variantId"), "size": item.get("size"), "sku": item.get("sku"),
                "operationType": "manual_reservation"}.items()):
            raise ValueError("Reservation operation evidence does not match the item.")
        if not release and (product.get("status") == "archived" or product.get("isActive") is False):
            raise ValueError("A selected product is no longer available.")
        original = product.get("variants", [])
        variants = deepcopy(original)
        variant_matches = [v for v in variants if v.get("id") == item.get("variantId")]
        variant = variant_matches[0] if len(variant_matches) == 1 else None
        if not variant or (not release and (variant.get("status") != "active" or variant.get("sku") != item.get("sku"))):
            raise ValueError("A selected variant is no longer available.")
        size_matches = [v for v in variant.get("sizeInventory", []) if v.get("size") == item.get("size")]
        size = size_matches[0] if len(size_matches) == 1 else None
        quantity = item.get("quantity")
        if isinstance(quantity, bool) or not isinstance(quantity, int) or quantity <= 0:
            raise ValueError("Order item quantity is invalid for stock reservation.")
        if not size or (not release and (int(size.get("stock", 0)) < quantity or int(variant.get("stock", 0)) < quantity)):
            raise ValueError("Stock changed. Confirm availability before accepting this order.")
        delta = quantity if release else -quantity
        size["stock"] = int(size.get("stock", 0)) + delta
        variant["stock"] = int(variant.get("stock", 0)) + delta
        query = {"_id": product_id, "variants": original, **({"status": {"$ne": "archived"}, "isActive": {"$ne": False}} if not release else {}), "manualReservations": {"$in" if release else "$nin": [marker]}}
        if release:
            query["inventoryOperationMarkers"] = operation_markers
            mutation = {"$set": {"variants": variants, "inventoryOperationMarkers.$[operation].state": "compensated", "inventoryOperationMarkers.$[operation].compensatedAt": datetime.now(timezone.utc)}, "$pull": {"manualReservations": marker}}
        else:
            query["inventoryOperationMarkers.operationId"] = {"$ne": operation_id}
            operation = {"operationId": operation_id, "orderId": str(order["_id"]), "itemIndex": int(index),
                         "productId": str(product_id), "quantity": quantity, "operationType": "manual_reservation",
                         "variantId": item.get("variantId"), "size": item.get("size"), "sku": item.get("sku"),
                         "stockDelta": -quantity, "state": "reserved", "claimToken": str(claim_token), "reservedAt": datetime.now(timezone.utc)}
            mutation = {"$set": {"variants": variants}, "$addToSet": {"manualReservations": marker}, "$push": {"inventoryOperationMarkers": operation}}
        options = {"array_filters": [{"operation.operationId": operation_id, "operation.state": "reserved", "operation.claimToken": claim_token}]} if release else {}
        if db.products.update_one(query, mutation, **options).modified_count == 1:
            return True
    raise ValueError("Inventory changed concurrently. Refresh and try again.")


def reserve_manual_acceptance(db, order, payload):
    from .order_fulfillment import OrderTransitionError, OrderTransitionConflict
    if order.get("requiresAvailabilityConfirmation") and payload.get("availabilityConfirmed") is not True:
        raise OrderTransitionError("Explicitly confirm availability before accepting this order.")
    if order.get("inventoryReservation") == "reserved":
        from .inventory_operations import operation_evidence, manual_reservation_recoverable
        if not manual_reservation_recoverable(operation_evidence(db, order)):
            raise OrderTransitionConflict("Saved reservation evidence is ambiguous. Investigation is required.")
        # A previous explicit recovery may have verified the atomic product
        # markers. Never reserve a second time on the subsequent acceptance.
        order_id = str(order["_id"])
        for index, item in enumerate(order.get("items", [])):
            if item.get("requiresAvailabilityConfirmation"):
                continue
            product = db.products.find_one({"_id": ObjectId(item["productId"])})
            marker = f"{order_id}:{index}"
            from .inventory_operations import manual_operation_id
            operation_id = manual_operation_id(order["_id"], index, order.get("inventoryReservationClaimToken") or "")
            operation = next((entry for entry in (product or {}).get("inventoryOperationMarkers", []) if entry.get("operationId") == operation_id), None)
            if not product or marker not in product.get("manualReservations", []) or not operation or operation.get("state") != "reserved" or int(operation.get("quantity") or 0) != int(item.get("quantity") or 0) or int(operation.get("stockDelta") or 0) != -int(item.get("quantity") or 0):
                raise OrderTransitionConflict("Saved stock reservation evidence is incomplete. Inventory reconciliation is required.")
        return ReservationAttempt(claim_token=order.get("inventoryReservationClaimToken"), owned=False)
    claim_token = token_hex(16)
    locked = db.orders.find_one_and_update(
        {"_id": order["_id"], "fulfillment.status": (order.get("fulfillment") or {}).get("status"),
         "items": order.get("items"),
         "inventoryReservation": {"$exists": False}},
        {"$set": {"inventoryReservation": "reserving", "inventoryReservationAt": datetime.now(timezone.utc), "inventoryReservationClaimToken": claim_token}},
        return_document=ReturnDocument.AFTER)
    if not locked:
        raise OrderTransitionConflict("Stock reservation is already in progress or needs staff reconciliation.")
    done = ReservationAttempt(claim_token=claim_token)
    try:
        for index, item in enumerate(order.get("items", [])):
            # Bespoke / explicitly confirmed made-to-order items do not consume ready stock.
            if item.get("requiresAvailabilityConfirmation"):
                continue
            changed = change_reservation(db, order, item, index, claim_token=claim_token)
            product = db.products.find_one({"_id": ObjectId(item["productId"])})
            from .inventory_operations import manual_operation_id
            operation_id = manual_operation_id(order["_id"], index, claim_token)
            operation = next((entry for entry in (product or {}).get("inventoryOperationMarkers", []) if entry.get("operationId") == operation_id), None)
            if not changed and (not operation or operation.get("state") != "reserved" or int(operation.get("quantity") or 0) != int(item.get("quantity") or 0)):
                raise ValueError("A prior reservation marker lacks matching durable operation evidence.")
            if changed:
                done.append((index, deepcopy(item)))
    except Exception as error:
        owner = db.orders.find_one({"_id": order["_id"]}) or {}
        if owner.get("inventoryReservation") != "reserving" or owner.get("inventoryReservationClaimToken") != claim_token:
            raise OrderTransitionConflict("This reservation attempt no longer owns the reconciliation claim.") from None
        try:
            for index, item in reversed(list(enumerate(order.get("items", [])))):
                owner = db.orders.find_one({"_id": order["_id"]}) or {}
                if owner.get("inventoryReservation") != "reserving" or owner.get("inventoryReservationClaimToken") != claim_token:
                    raise RuntimeError("Reservation claim changed during rollback.")
                change_reservation(db, order, item, index, release=True, claim_token=claim_token)
            remaining = any((db.products.find_one({"_id": ObjectId(item["productId"]), "manualReservations": f"{order['_id']}:{index}"}) is not None)
                            for index, item in enumerate(order.get("items", [])))
        except Exception:
            db.orders.update_one({"_id": order["_id"], "inventoryReservation": "reserving", "inventoryReservationClaimToken": claim_token}, {"$set": {"inventoryReservation": "unresolved"}})
            raise OrderTransitionConflict("Reservation rollback needs staff reconciliation. Do not retry acceptance.") from None
        if remaining:
            db.orders.update_one({"_id": order["_id"], "inventoryReservation": "reserving", "inventoryReservationClaimToken": claim_token}, {"$set": {"inventoryReservation": "unresolved"}})
            if isinstance(error, ValueError):
                raise OrderTransitionError(str(error)) from None
            raise OrderTransitionConflict("Reservation rollback needs staff reconciliation. Do not retry acceptance.") from None
        db.orders.update_one({"_id": order["_id"], "inventoryReservation": "reserving", "inventoryReservationClaimToken": claim_token}, {"$unset": {"inventoryReservation": "", "inventoryReservationClaimToken": ""}})
        raise OrderTransitionError(str(error)) from None
    return done


def rollback_manual_acceptance(db, order, reservations):
    if not isinstance(reservations, ReservationAttempt):
        raise RuntimeError("The original reservation attempt is required for rollback.")
    if not reservations.owned:
        return
    claim_token = reservations.claim_token
    persisted = db.orders.find_one({"_id": order["_id"]}) or {}
    if not persisted.get("inventoryReservationClaimToken") and not persisted.get("inventoryReservation"):
        # A repeated completed compensation is a no-op only when no newer
        # reservation owns the order and this attempt's markers are terminal.
        from .inventory_operations import manual_operation_id
        for index, item in reservations:
            product = db.products.find_one({"_id": ObjectId(item["productId"])}) or {}
            rows = [m for m in product.get("inventoryOperationMarkers", []) if m.get("operationId") == manual_operation_id(order["_id"], index, claim_token)]
            if len(rows) != 1 or rows[0].get("state") != "compensated":
                raise RuntimeError("Rollback completion cannot be proven.")
        return
    if persisted.get("inventoryReservation") != "reserving" or persisted.get("inventoryReservationClaimToken") != claim_token:
        raise RuntimeError("The original reservation claim no longer owns this order.")
    for index, item in reversed(list(enumerate(order.get("items", [])))):
        latest = db.orders.find_one({"_id": order["_id"]}) or {}
        if latest.get("inventoryReservation") != "reserving" or latest.get("inventoryReservationClaimToken") != claim_token:
            raise RuntimeError("Reservation claim changed before rollback; stock was not modified.")
        change_reservation(db, order, item, index, release=True, claim_token=claim_token)
    remaining = any((db.products.find_one({"_id": ObjectId(item["productId"]), "manualReservations": f"{order['_id']}:{index}"}) is not None)
                    for index, item in enumerate(order.get("items", [])))
    if remaining:
        db.orders.update_one({"_id": order["_id"], "inventoryReservation": "reserving", "inventoryReservationClaimToken": claim_token}, {"$set": {"inventoryReservation": "unresolved"}})
        raise RuntimeError("Reservation rollback remains incomplete.")
    db.orders.update_one({"_id": order["_id"], "inventoryReservation": "reserving", "inventoryReservationClaimToken": claim_token}, {"$unset": {"inventoryReservation": "", "inventoryReservationClaimToken": ""}})
