"""Idempotent stock reservation for manual acceptance, with compensating rollback.

Every product mutation includes its reservation marker in the same atomic write.
An interrupted acceptance stays locked for staff reconciliation, never retried blindly.
"""
from copy import deepcopy
from datetime import datetime, timezone
from bson import ObjectId
from pymongo import ReturnDocument


def change_reservation(db, order, item, index, release=False):
    marker = f"{order['_id']}:{index}"
    product_id = ObjectId(item["productId"])
    for _ in range(5):
        product = db.products.find_one({"_id": product_id})
        if not product:
            raise ValueError("A selected product is no longer available.")
        markers = product.get("manualReservations", [])
        if (marker not in markers) == release:
            # Tell the acceptance saga whether this attempt actually changed
            # inventory. A pre-existing marker belongs to an earlier attempt
            # and must never be released by this attempt's compensation.
            return False
        if not release and (product.get("status") == "archived" or product.get("isActive") is False):
            raise ValueError("A selected product is no longer available.")
        original = product.get("variants", [])
        variants = deepcopy(original)
        variant = next((v for v in variants if v.get("id") == item.get("variantId")), None)
        if not variant or (not release and (variant.get("status") != "active" or variant.get("sku") != item.get("sku"))):
            raise ValueError("A selected variant is no longer available.")
        size = next((v for v in variant.get("sizeInventory", []) if v.get("size") == item.get("size")), None)
        quantity = int(item["quantity"])
        if not size or (not release and int(size.get("stock", 0)) < quantity):
            raise ValueError("Stock changed. Confirm availability before accepting this order.")
        delta = quantity if release else -quantity
        size["stock"] = int(size.get("stock", 0)) + delta
        variant["stock"] = int(variant.get("stock", 0)) + delta
        query = {"_id": product_id, "variants": original, **({"status": {"$ne": "archived"}, "isActive": {"$ne": False}} if not release else {}), "manualReservations": {"$in" if release else "$nin": [marker]}}
        mutation = {"$set": {"variants": variants}, "$pull" if release else "$addToSet": {"manualReservations": marker}}
        if db.products.update_one(query, mutation).modified_count == 1:
            return True
    raise ValueError("Inventory changed concurrently. Refresh and try again.")


def reserve_manual_acceptance(db, order, payload):
    from .order_fulfillment import OrderTransitionError, OrderTransitionConflict
    if order.get("requiresAvailabilityConfirmation") and payload.get("availabilityConfirmed") is not True:
        raise OrderTransitionError("Explicitly confirm availability before accepting this order.")
    locked = db.orders.find_one_and_update(
        {"_id": order["_id"], "fulfillment.status": (order.get("fulfillment") or {}).get("status"),
         "inventoryReservation": {"$exists": False}},
        {"$set": {"inventoryReservation": "reserving", "inventoryReservationAt": datetime.now(timezone.utc)}},
        return_document=ReturnDocument.AFTER)
    if not locked:
        raise OrderTransitionConflict("Stock reservation is already in progress or needs staff reconciliation.")
    done = []
    try:
        for index, item in enumerate(order.get("items", [])):
            # Bespoke / explicitly confirmed made-to-order items do not consume ready stock.
            if item.get("requiresAvailabilityConfirmation"):
                continue
            if change_reservation(db, order, item, index):
                done.append((index, item))
    except Exception as error:
        try:
            for index, item in reversed(done):
                change_reservation(db, order, item, index, release=True)
            db.orders.update_one({"_id": order["_id"], "inventoryReservation": "reserving"}, {"$unset": {"inventoryReservation": ""}})
        except Exception:
            raise OrderTransitionConflict("Reservation rollback needs staff reconciliation. Do not retry acceptance.") from None
        raise OrderTransitionError(str(error)) from None
    return done


def rollback_manual_acceptance(db, order, reservations):
    for index, item in reversed(reservations):
        change_reservation(db, order, item, index, release=True)
    db.orders.update_one({"_id": order["_id"], "inventoryReservation": "reserving"}, {"$unset": {"inventoryReservation": ""}})
