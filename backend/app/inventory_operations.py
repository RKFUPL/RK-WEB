"""Durable, fail-closed inventory operation evidence.

MongoDB transactions are deliberately not assumed here.  A product's stock
change and operation marker are written atomically in that product document;
the separate inventory_operations collection is a recoverable index.  A
missing index row is never evidence that stock was not changed.
"""
from __future__ import annotations

from datetime import datetime, timezone
import hashlib
from copy import deepcopy
from bson import ObjectId


UNRESOLVED_CAPTURE_STATES = {"processing", "held", "unresolved", "compensation_pending"}
MANUAL_STOCK_FULFILLMENT_STATES = {
    "confirmed", "order_accepted", "processing", "packed", "shipped",
    "out_for_delivery", "delivered",
}


def capture_operation_id(order_id, capture_id, item_index):
    raw = f"razorpay-capture\0{order_id}\0{capture_id}\0{int(item_index)}"
    return "inv_" + hashlib.sha256(raw.encode("utf-8")).hexdigest()


def manual_operation_id(order_id, item_index, claim_token):
    """Stable within one reservation attempt, distinct after a safe rollback."""
    raw = f"manual-reservation\0{order_id}\0{int(item_index)}\0{claim_token}"
    return "manual_" + hashlib.sha256(raw.encode("utf-8")).hexdigest()


def inventory_block_reason(order: dict) -> str | None:
    """Return a staff-safe reason while persisted inventory evidence is incomplete."""
    capture_state = str(order.get("captureFulfillmentStatus") or "").lower()
    if capture_state in UNRESOLVED_CAPTURE_STATES:
        return "capture_inventory_unresolved"
    if capture_state and capture_state != "completed":
        # Unknown non-empty capture states fail closed.
        return "capture_inventory_unresolved"
    reservation_state = str(order.get("inventoryReservation") or "").lower()
    if reservation_state in {"reserving", "unresolved", "reconciliation_required", "compensation_pending"}:
        return "manual_inventory_unresolved"
    if reservation_state and reservation_state not in {"reserved", "released"}:
        return "manual_inventory_unresolved"
    return None


def persisted_inventory_block_reason(db, order: dict) -> str | None:
    current = db.orders.find_one({"_id": order.get("_id")}) or order
    reason = inventory_block_reason(current)
    if reason:
        return reason
    capture_id = current.get("razorpayPaymentId") or (current.get("payment") or {}).get("razorpayPaymentId")
    captured = bool(capture_id or current.get("captureEvidence") or current.get("captureFulfillmentStatus")
                    or current.get("paymentStatus") == "paid" or (current.get("payment") or {}).get("status") == "paid")
    if current.get("paymentGateway") != "manual" and captured:
        if current.get("captureFulfillmentStatus") != "completed":
            return "capture_inventory_unresolved"
        if capture_id and current.get("items"):
            evidence = operation_evidence(db, current)
            if not evidence["capture"] or not all(row.get("markerMatches") and row.get("state") == "applied" for row in evidence["capture"]):
                return "capture_inventory_unresolved"
    if current.get("paymentGateway") == "manual":
        fulfillment = current.get("fulfillment") if isinstance(current.get("fulfillment"), dict) else {}
        fulfillment_state = str(fulfillment.get("status") or current.get("fulfillmentStatus") or current.get("status") or "").lower()
        if current.get("inventoryReservation") == "reserved":
            evidence = operation_evidence(db, current)
            if not manual_reservation_recoverable(evidence):
                return "manual_inventory_unresolved"
        elif fulfillment_state in MANUAL_STOCK_FULFILLMENT_STATES:
            return "manual_inventory_unresolved"
    # Any nonterminal per-order operation blocks, even if the denormalized
    # order state was lost or was not updated after an interrupted write.
    try:
        unresolved = db.inventory_operations.find_one({
            "orderId": str(order.get("_id")),
            "state": {"$nin": ["applied", "compensated", "not_required"]},
        })
    except Exception:
        unresolved = None
    if unresolved:
        return "inventory_operation_unresolved"
    return None


def _now():
    return datetime.now(timezone.utc)


def prepare_capture_operation(db, order, capture_id, index, item, claim_token):
    """Create/reuse a stable ledger intent before attempting a product write."""
    op_id = capture_operation_id(order["_id"], capture_id, index)
    record = {
        "_id": op_id,
        "operationId": op_id,
        "orderId": str(order["_id"]),
        "captureId": str(capture_id),
        "itemIndex": int(index),
        "productId": str(item.get("productId") or ""),
        "quantity": int(item.get("quantity") or 0),
        "operationType": "capture_deduction",
        "state": "planned",
        "claimToken": str(claim_token),
        "createdAt": _now(),
        "updatedAt": _now(),
    }
    db.inventory_operations.update_one(
        {"_id": op_id},
        {"$setOnInsert": record},
        upsert=True,
    )
    current = db.inventory_operations.find_one({"_id": op_id})
    if not current or current.get("claimToken") != claim_token:
        raise RuntimeError("Inventory operation is owned by another capture attempt.")
    return current


def mark_capture_operation(db, operation_id, claim_token, state, **fields):
    result = db.inventory_operations.update_one(
        {"_id": operation_id, "claimToken": claim_token,
         "state": {"$nin": ["applied", "compensated", "unresolved"]}},
        {"$set": {"state": state, "updatedAt": _now(), **fields}},
    )
    if result.modified_count != 1:
        current = db.inventory_operations.find_one({"_id": operation_id})
        if not current or current.get("state") != state:
            raise RuntimeError("Inventory operation state changed concurrently.")
    return db.inventory_operations.find_one({"_id": operation_id})


def record_capture_product_marker(db, product_id, operation):
    """Persist a marker in the same atomic update as the stock delta."""
    marker = {
        "operationId": operation["operationId"],
        "orderId": operation["orderId"],
        "captureId": operation["captureId"],
        "itemIndex": operation["itemIndex"],
        "quantity": operation["quantity"],
        "operationType": operation["operationType"],
        "state": "applied",
        "claimToken": operation["claimToken"],
        "appliedAt": _now(),
    }
    return marker


def reconcile_capture_ledger_from_product(db, order_id):
    """Repair missing/stale ledger projections from authoritative product markers."""
    repaired = []
    for product in db.products.find({"inventoryOperationMarkers.orderId": str(order_id)}):
        for marker in product.get("inventoryOperationMarkers", []):
            if marker.get("orderId") != str(order_id):
                continue
            op_id = marker.get("operationId")
            if not op_id:
                continue
            record = {
                "_id": op_id, "operationId": op_id, "orderId": str(order_id),
                "captureId": marker.get("captureId"), "itemIndex": marker.get("itemIndex"),
                "productId": str(product.get("_id")), "quantity": marker.get("quantity"),
                "operationType": marker.get("operationType"), "state": marker.get("state", "applied"),
                "stockDelta": marker.get("stockDelta"), "stockPath": marker.get("stockPath"),
                "variantId": marker.get("variantId"), "size": marker.get("size"),
                "claimToken": marker.get("claimToken"), "createdAt": marker.get("appliedAt"),
                "updatedAt": _now(), "reconstructedFromProductMarker": True,
            }
            db.inventory_operations.update_one({"_id": op_id}, {"$setOnInsert": record}, upsert=True)
            # Marker is authoritative if the ledger write had not reached applied.
            db.inventory_operations.update_one(
                {"_id": op_id, "claimToken": marker.get("claimToken")},
                {"$set": {"state": marker.get("state", "applied"), "updatedAt": _now(),
                          "productMarkerObserved": True, "stockDelta": marker.get("stockDelta"),
                          "stockPath": marker.get("stockPath"), "variantId": marker.get("variantId"), "size": marker.get("size")}},
            )
            repaired.append(op_id)
    return repaired


def operation_evidence(db, order):
    """Read-only evidence summary for the authorized staff order view."""
    order_id = str(order.get("_id"))
    capture_id = order.get("razorpayPaymentId") or (order.get("payment") or {}).get("razorpayPaymentId")
    capture_items = []
    if order.get("paymentGateway") != "manual" and capture_id:
        for index, item in enumerate(order.get("items", [])):
            op_id = capture_operation_id(order_id, capture_id, index)
            product = None
            try:
                product = db.products.find_one({"_id": ObjectId(str(item.get("productId")))})
            except Exception:
                pass
            operation_markers = [m for m in (product or {}).get("inventoryOperationMarkers", []) if m.get("operationId") == op_id]
            marker = operation_markers[0] if len(operation_markers) == 1 else None
            ledger = db.inventory_operations.find_one({"_id": op_id})
            capture_items.append({
                "operationId": op_id, "itemIndex": index, "productId": str(item.get("productId") or ""),
                "quantity": int(item.get("quantity") or 0), "state": (marker or {}).get("state") or (ledger or {}).get("state") or "unresolved",
                "stockDelta": (marker or {}).get("stockDelta", (ledger or {}).get("stockDelta")),
                "createdAt": (marker or {}).get("appliedAt", (ledger or {}).get("createdAt")),
                "updatedAt": (marker or {}).get("compensatedAt", (ledger or {}).get("updatedAt")),
                "productMarkerPresent": bool(operation_markers), "markerConflict": len(operation_markers) > 1,
                "markerMatches": bool(len(operation_markers) == 1 and marker and marker.get("captureId") == str(capture_id)
                    and marker.get("orderId") == order_id
                    and marker.get("itemIndex") == index and int(marker.get("quantity") or 0) == int(item.get("quantity") or 0)
                    and marker.get("operationType") == "capture_deduction"
                    and str(marker.get("claimToken") or "") == str(order.get("captureClaimToken") or "")
                    and int(marker.get("stockDelta") or 0) == -int(item.get("quantity") or 0)
                    and str(product.get("_id")) == str(item.get("productId") or "")),
                "compensated": bool(marker and marker.get("state") == "compensated"),
            })
    manual_items = []
    if order.get("paymentGateway") == "manual":
        for index, item in enumerate(order.get("items", [])):
            marker = f"{order_id}:{index}"
            try:
                product = db.products.find_one({"_id": ObjectId(str(item.get("productId")))})
            except Exception:
                product = None
            required = not item.get("requiresAvailabilityConfirmation")
            reservation_count = (product or {}).get("manualReservations", []).count(marker)
            present = reservation_count > 0
            operation_id = manual_operation_id(order_id, index, order.get("inventoryReservationClaimToken") or "")
            operation_markers = [entry for entry in (product or {}).get("inventoryOperationMarkers", [])
                                 if entry.get("operationId") == operation_id]
            operation = operation_markers[0] if len(operation_markers) == 1 else None
            operation_matches = bool(len(operation_markers) == 1 and reservation_count == 1 and operation and operation.get("state") == "reserved"
                                     and operation.get("operationType") == "manual_reservation"
                                     and operation.get("orderId") == order_id
                                     and operation.get("itemIndex") == index
                                     and all(operation.get(key) == item.get(key) for key in ("variantId", "size", "sku"))
                                     and str(operation.get("productId")) == str(item.get("productId"))
                                     and int(operation.get("quantity") or 0) == int(item.get("quantity") or 0)
                                     and int(operation.get("stockDelta") or 0) == -int(item.get("quantity") or 0)
                                     and str(operation.get("claimToken") or "") == str(order.get("inventoryReservationClaimToken") or ""))
            manual_items.append({"operationId": (operation or {}).get("operationId") or operation_id, "reservationKey": marker, "itemIndex": index, "productId": str(item.get("productId") or ""),
                                 "quantity": int(item.get("quantity") or 0), "state": "reserved" if present and operation_matches else "unresolved",
                                 "stockDelta": -int(item.get("quantity") or 0) if present else None,
                                 "createdAt": (operation or {}).get("reservedAt"), "updatedAt": (operation or {}).get("compensatedAt"),
                                 "productMarkerPresent": present, "markerConflict": len(operation_markers) > 1 or reservation_count > 1,
                                 "markerMatches": bool(present and operation_matches) if required else True,
                                 "compensated": False, "required": required})
    return {"capture": capture_items, "manual": manual_items}


def capture_recoverable(report):
    rows = report.get("capture", [])
    return bool(rows) and all(row.get("productMarkerPresent") and row.get("markerMatches")
                              and row.get("state") == "applied" and not row.get("compensated") for row in rows)


def manual_reservation_recoverable(report):
    rows = [row for row in report.get("manual", []) if row.get("required")]
    return all(row.get("productMarkerPresent") and row.get("markerMatches") for row in rows)


def compensate_capture_markers(db, order_id, claim_token):
    """Reverse only stock deltas proven applied by this exact capture claim."""
    order = db.orders.find_one({"_id": order_id}) or {}
    evidence = operation_evidence(db, order)
    if (order.get("captureClaimToken") != claim_token or any(
            not row.get("markerMatches") or row.get("state") not in {"applied", "compensated"}
            for row in evidence["capture"])):
        raise RuntimeError("Capture compensation requires unique matching product evidence and claim ownership.")
    reconcile_capture_ledger_from_product(db, order_id)
    rows = list(db.inventory_operations.find({"orderId": str(order_id), "claimToken": claim_token, "state": "applied"}))
    for row in rows:
        product_id = ObjectId(str(row["productId"]))
        product = db.products.find_one({"_id": product_id})
        marker = next((m for m in (product or {}).get("inventoryOperationMarkers", [])
                       if m.get("operationId") == row["operationId"]), None)
        if not marker or marker.get("claimToken") != claim_token:
            raise RuntimeError("Capture compensation evidence is missing or inconsistent.")
        if marker.get("state") == "compensated":
            continue
        if marker.get("state") != "applied" or marker.get("stockDelta") != -int(row.get("quantity") or 0):
            raise RuntimeError("Capture compensation evidence is ambiguous.")
        amount = int(row["quantity"])
        variant_id, size = marker.get("variantId"), marker.get("size")
        committed = False
        for _ in range(5):
            product = db.products.find_one({"_id": product_id}) or {}
            variants_before = deepcopy(product.get("variants", []))
            sizes_before = deepcopy(product.get("sizeInventory", []))
            markers_before = deepcopy(product.get("inventoryOperationMarkers", []))
            current_marker = next((m for m in markers_before if m.get("operationId") == row["operationId"]), None)
            if (sum(m.get("operationId") == row["operationId"] for m in markers_before) != 1
                    or any((current_marker or {}).get(key) != marker.get(key) for key in
                           ("orderId", "captureId", "itemIndex", "quantity", "claimToken", "stockDelta", "operationType", "variantId", "size"))):
                raise RuntimeError("Capture compensation product proof changed or is ambiguous.")
            if current_marker and current_marker.get("state") == "compensated":
                committed = True
                break
            if not current_marker or current_marker.get("state") != "applied" or current_marker.get("claimToken") != claim_token:
                raise RuntimeError("Capture compensation compare-and-set failed.")
            if variant_id:
                variant = next((v for v in variants_before if str(v.get("id")) == str(variant_id)), None)
                if not variant:
                    raise RuntimeError("Capture compensation variant evidence is missing.")
                variant["stock"] = int(variant.get("stock") or 0) + amount
                if size:
                    size_row = next((s for s in variant.get("sizeInventory", []) if str(s.get("size") or "").upper() == str(size).upper()), None)
                    if not size_row:
                        raise RuntimeError("Capture compensation size evidence is missing.")
                    size_row["stock"] = int(size_row.get("stock") or 0) + amount
            elif size:
                size_row = next((s for s in sizes_before if str(s.get("size") or "").upper() == str(size).upper()), None)
                if not size_row:
                    raise RuntimeError("Capture compensation size evidence is missing.")
                size_row["stock"] = int(size_row.get("stock") or 0) + amount
                product["stock"] = int(product.get("stock") or 0) + amount
            else:
                product["stock"] = int(product.get("stock") or 0) + amount
            current_marker.update({"state": "compensated", "compensatedAt": _now()})
            query = {"_id": product_id, "inventoryOperationMarkers": product.get("inventoryOperationMarkers", [])}
            update_values = {"inventoryOperationMarkers": markers_before, "updatedAt": _now()}
            if variants_before:
                query["variants"] = product.get("variants", [])
                update_values["variants"] = variants_before
                from .inventory import allocated_variant_total
                update_values.update(allocated_variant_total(product, variants_before))
            if sizes_before:
                query["sizeInventory"] = product.get("sizeInventory", [])
                update_values["sizeInventory"] = sizes_before
            if "stock" in product and not variant_id:
                query["stock"] = int(product.get("stock", 0)) - (amount if not size else amount)
                update_values["stock"] = product["stock"]
            if db.products.update_one(query, {"$set": update_values}).modified_count == 1:
                committed = True
                break
        if not committed:
            raise RuntimeError("Capture compensation compare-and-set failed.")
        db.inventory_operations.update_one({"_id": row["operationId"], "claimToken": claim_token},
                                           {"$set": {"state": "compensated", "compensatedAt": _now(), "updatedAt": _now()}})
