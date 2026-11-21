"""Real MongoDB regressions for the independently reproduced unsafe paths."""
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import datetime, timezone
from threading import Barrier, local
from uuid import uuid4

from bson import ObjectId
from pymongo.collection import Collection
import pytest

from app.blueprints.payments.routes import _decrement_tracked_variant_inventory
from app.manual_inventory import reserve_manual_acceptance, rollback_manual_acceptance
from .test_inventory_real_mongodb import (
    _stock_product, _capture_order, _manual_order, _run_crash_worker, _minimal_staff_app,
)

pytestmark = pytest.mark.real_mongodb


def variant_product(box, stock=2):
    return box["insert_product"]({"_id": ObjectId(), "status": "active", "isActive": True,
        "variants": [{"id": v, "sku": v, "status": "active", "stock": stock,
                      "sizeInventory": [{"size": "S", "stock": stock}, {"size": "M", "stock": stock}]}
                     for v in ("ivory", "blue")]})


def operation(order, index=0):
    return {"operationId": "test_" + uuid4().hex, "orderId": str(order["_id"]),
            "captureId": order["_testCaptureId"], "itemIndex": index, "quantity": 1,
            "operationType": "capture_deduction", "claimToken": "synthetic-capture-claim"}


def deduct(db, product, op, variant="ivory", size="S"):
    return _decrement_tracked_variant_inventory(db, product,
        next(v for v in product["variants"] if v["id"] == variant), size, 1, datetime.now(timezone.utc), op)


@pytest.mark.parametrize("variant,size", [("ivory", ""), ("ivory", "S"), ("blue", "M")])
def test_truthful_variant_deduction_and_duplicate_operation(inventory_sandbox, variant, size):
    box=inventory_sandbox; product=variant_product(box); order=_capture_order(box, [(product,1)])
    op=operation(order)
    assert deduct(box["db"],product,op,variant,size)
    before=box["db"].products.find_one({"_id":product["_id"]})
    assert deduct(box["db"],product,op,variant,size)
    assert box["db"].products.find_one({"_id":product["_id"]}) == before
    target=next(v for v in before["variants"] if v["id"]==variant)
    assert target["stock"]==1
    if size: assert next(s for s in target["sizeInventory"] if s["size"]==size)["stock"]==1
    assert len(before["inventoryOperationMarkers"])==1
    assert before["inventoryOperationMarkers"][0]["stockDelta"]==-1


@pytest.mark.parametrize("damage", ["zero_variant", "zero_size", "missing_size", "inactive", "duplicate_size", "conflicting_marker"])
def test_failed_variant_condition_never_invents_marker(inventory_sandbox, damage):
    box=inventory_sandbox; product=variant_product(box); order=_capture_order(box,[(product,1)]); op=operation(order)
    current=deepcopy(product)
    if damage=="zero_variant":current["variants"][0]["stock"]=0
    elif damage=="zero_size":current["variants"][0]["sizeInventory"][0]["stock"]=0
    elif damage=="missing_size":current["variants"][0]["sizeInventory"]=[]
    elif damage=="inactive":current["variants"][0]["status"]="archived"
    elif damage=="duplicate_size":current["variants"][0]["sizeInventory"].append({"size":"S","stock":2})
    else:current["inventoryOperationMarkers"]=[{**op,"state":"applied","claimToken":"different-owner"}]
    box["db"].products.replace_one({"_id":product["_id"]},current)
    assert not deduct(box["db"],product,op)
    assert box["db"].products.find_one({"_id":product["_id"]})==current


@pytest.mark.parametrize("targets,stock,successes", [
    ([("ivory","S"),("ivory","S")],1,1),
    ([("ivory","S"),("ivory","M")],2,2),
    ([("ivory","S"),("blue","S")],1,2),
    ([("ivory",""),("ivory","")],1,1),
])
def test_competing_stale_reads_at_the_atomic_product_write(inventory_sandbox, monkeypatch, targets, stock, successes):
    box=inventory_sandbox; product=variant_product(box,stock); order=_capture_order(box,[(product,1)])
    ops=[operation(order,index) for index in range(2)]
    barrier=Barrier(2); thread=local(); original=Collection.update_one; snapshots=[]
    def competing(collection,query,update,*args,**kwargs):
        if collection.name=="products" and query.get("_id")==product["_id"] and "$push" in update and not getattr(thread,"waited",False):
            thread.waited=True; snapshots.append(deepcopy(query["variants"]))
            barrier.wait(timeout=10)  # Both reads have completed; neither write has started.
        return original(collection,query,update,*args,**kwargs)
    monkeypatch.setattr(Collection,"update_one",competing)
    def run(index):return bool(deduct(box["db"],product,ops[index],*targets[index]))
    with ThreadPoolExecutor(max_workers=2) as pool: results=list(pool.map(run,range(2)))
    assert sum(results)==successes and snapshots[0]==snapshots[1]
    saved=box["db"].products.find_one({"_id":product["_id"]})
    markers=saved.get("inventoryOperationMarkers",[])
    assert len(markers)==successes
    for variant in saved["variants"]:
        applied=[m for m in markers if m["variantId"]==variant["id"]]
        assert variant["stock"]==stock-len(applied)>=0
        for size in variant["sizeInventory"]:
            assert size["stock"]==stock-sum(m.get("size")==size["size"] for m in applied)>=0
    assert {m["operationId"] for m in markers}=={ops[i]["operationId"] for i,ok in enumerate(results) if ok}


def test_multiple_items_share_parent_without_losing_other_variant_changes(inventory_sandbox):
    box=inventory_sandbox; product=variant_product(box,3); order=_capture_order(box,[(product,1)])
    for index,(variant,size) in enumerate([("ivory","S"),("ivory","M"),("blue","S")]):
        assert deduct(box["db"],product,operation(order,index),variant,size)
    saved=box["db"].products.find_one({"_id":product["_id"]})
    assert [v["stock"] for v in saved["variants"]]==[1,2]
    assert len(saved["inventoryOperationMarkers"])==3


def test_parent_size_stock_and_marker_are_one_adjustment(inventory_sandbox):
    from .test_inventory_real_mongodb import _run_capture
    box=inventory_sandbox; product=_stock_product(box,2)
    box["db"].products.update_one({"_id":product["_id"]},{"$set":{
        "sizeInventoryConfigured":True,"sizeInventory":[{"size":"S","stock":2,"enabled":True}]}})
    order=_capture_order(box,[(product,1)])
    box["db"].orders.update_one({"_id":order["_id"]},{"$set":{"items.0.size":"S"}})
    captured,changed=_run_capture(box["db"],order)
    assert changed and captured["captureFulfillmentStatus"]=="completed"
    saved=box["db"].products.find_one({"_id":product["_id"]})
    assert saved["stock"]==saved["sizeInventory"][0]["stock"]==1
    assert len(saved["inventoryOperationMarkers"])==1


def test_parent_insufficient_stock_remains_held_without_marker(inventory_sandbox):
    from .test_inventory_real_mongodb import _run_capture
    box=inventory_sandbox;p=_stock_product(box,0);order=_capture_order(box,[(p,1)])
    with pytest.raises(ValueError):_run_capture(box["db"],order)
    saved=box["db"].products.find_one({"_id":p["_id"]})
    assert saved["stock"]==0 and not saved.get("inventoryOperationMarkers")
    assert box["db"].orders.find_one({"_id":order["_id"]})["captureFulfillmentStatus"]=="held"


def test_ambiguous_manual_marker_cannot_authorize_release(inventory_sandbox):
    box=inventory_sandbox;db=box["db"];p=_stock_product(box,4,variants=True);order=_manual_order(box,[(p,1)])
    attempt=reserve_manual_acceptance(db,order,{})
    product=db.products.find_one({"_id":p["_id"]})
    db.products.update_one({"_id":p["_id"]},{"$push":{"inventoryOperationMarkers":product["inventoryOperationMarkers"][0]}})
    before=db.products.find_one({"_id":p["_id"]})
    with pytest.raises(ValueError):rollback_manual_acceptance(db,order,attempt)
    assert db.products.find_one({"_id":p["_id"]})==before
    assert db.orders.find_one({"_id":order["_id"]})["inventoryReservation"]=="reserving"


@pytest.mark.parametrize("damage", ["duplicate", "wrong_state"])
def test_capture_compensation_rejects_ambiguous_proof(inventory_sandbox,damage):
    from .test_inventory_real_mongodb import _run_capture
    from app.inventory_operations import compensate_capture_markers, persisted_inventory_block_reason
    box=inventory_sandbox;db=box["db"];p=_stock_product(box,4);order=_capture_order(box,[(p,1)])
    captured,_=_run_capture(db,order)
    product=db.products.find_one({"_id":p["_id"]})
    update={"$push":{"inventoryOperationMarkers":product["inventoryOperationMarkers"][0]}} if damage=="duplicate" else {"$set":{"inventoryOperationMarkers.0.state":"planned"}}
    db.products.update_one({"_id":p["_id"]},update)
    before=db.products.find_one({"_id":p["_id"]})
    with pytest.raises(RuntimeError):compensate_capture_markers(db,order["_id"],captured["captureClaimToken"])
    assert db.products.find_one({"_id":p["_id"]})==before
    assert persisted_inventory_block_reason(db,captured)


def test_old_manual_rollback_cannot_acquire_new_claim_and_markers_are_exact(inventory_sandbox):
    box=inventory_sandbox; db=box["db"]; product=_stock_product(box,4,variants=True)
    order=_manual_order(box,[(product,1)])
    first=reserve_manual_acceptance(db,order,{})
    rollback_manual_acceptance(db,order,first)
    second=reserve_manual_acceptance(db,db.orders.find_one({"_id":order["_id"]}),{})
    before_product=db.products.find_one({"_id":product["_id"]});before_order=db.orders.find_one({"_id":order["_id"]})
    with pytest.raises(RuntimeError):rollback_manual_acceptance(db,order,first)
    assert db.products.find_one({"_id":product["_id"]})==before_product
    assert db.orders.find_one({"_id":order["_id"]})==before_order
    rollback_manual_acceptance(db,before_order,second)
    released=db.products.find_one({"_id":product["_id"]})
    assert released["variants"][0]["stock"]==4
    assert [m["state"] for m in released["inventoryOperationMarkers"]]==["compensated","compensated"]
    rollback_manual_acceptance(db,before_order,second)
    assert db.products.find_one({"_id":product["_id"]})==released


@pytest.mark.parametrize("closed", ["cancelled","returned","refunded","delivered","return_requested"])
def test_closed_capture_recovery_never_reopens_order(inventory_sandbox,monkeypatch,closed):
    box=inventory_sandbox;db=box["db"];p=_stock_product(box,4);order=_capture_order(box,[(p,1)])
    assert _run_crash_worker(box,order,"capture-before-final")==80
    db.orders.update_one({"_id":order["_id"]},{"$set":{"fulfillment.status":closed,"status":closed}})
    before=db.orders.find_one({"_id":order["_id"]});stock=db.products.find_one({"_id":p["_id"]})
    app,headers,_=_minimal_staff_app(db,monkeypatch,box["track_user"])
    with app.test_client() as client:
        response=client.post(f"/api/staff/orders/{order['_id']}/inventory-reconciliation",headers=headers,
            json={"action":"reconcile_product_markers","reason":"Verify closed capture operation"})
    assert response.status_code==409
    assert db.orders.find_one({"_id":order["_id"]})==before
    assert db.products.find_one({"_id":p["_id"]})==stock


def test_cancellation_wins_compare_and_set_against_recovery(inventory_sandbox,monkeypatch):
    box=inventory_sandbox;db=box["db"];p=_stock_product(box,4);order=_capture_order(box,[(p,1)])
    assert _run_crash_worker(box,order,"capture-before-final")==80
    app,headers,_=_minimal_staff_app(db,monkeypatch,box["track_user"])
    original=Collection.find_one_and_update
    def close_before_commit(collection,query,update,*args,**kwargs):
        if collection.name=="orders" and update.get("$set",{}).get("captureFulfillmentStatus")=="completed":
            collection.update_one({"_id":order["_id"]},{"$set":{"fulfillment.status":"cancelled","status":"cancelled"}})
        return original(collection,query,update,*args,**kwargs)
    monkeypatch.setattr(Collection,"find_one_and_update",close_before_commit)
    with app.test_client() as client:
        response=client.post(f"/api/staff/orders/{order['_id']}/inventory-reconciliation",headers=headers,
            json={"action":"reconcile_product_markers","reason":"Contested lifecycle closure"})
    assert response.status_code==409
    saved=db.orders.find_one({"_id":order["_id"]})
    assert saved["fulfillment"]["status"]=="cancelled" and saved["captureFulfillmentStatus"]=="processing"
    assert not saved.get("inventoryRecoveryAudit")
    assert db.products.find_one({"_id":p["_id"]})["stock"]==3


def investigation_payload(db,order):
    from app.inventory_operations import operation_evidence
    row=operation_evidence(db,db.orders.find_one({"_id":order["_id"]}))["capture"][0]
    return {"operationId":row["operationId"],"productId":row["productId"],"itemIndex":row["itemIndex"],
            "reason":"Review interrupted warehouse operation","findings":"Warehouse count requires supervisor review",
            "evidenceReference":"WAREHOUSE-TEST-01","externalStockCount":3,"outcome":"escalated","followUpStatus":"awaiting_administrator"}


def test_concurrent_investigations_are_append_only_and_never_unblock(inventory_sandbox,monkeypatch):
    box=inventory_sandbox;db=box["db"];p=_stock_product(box,4);order=_capture_order(box,[(p,1)])
    assert _run_crash_worker(box,order,"capture",1)==71
    app,headers,_=_minimal_staff_app(db,monkeypatch,box["track_user"])
    payload=investigation_payload(db,order); before=db.orders.find_one({"_id":order["_id"]});stock=db.products.find_one({"_id":p["_id"]})
    barrier=Barrier(2)
    def post(_):
        with app.test_client() as client:
            barrier.wait(timeout=10)
            return client.post(f"/api/staff/orders/{order['_id']}/inventory-investigations",headers=headers,json=payload).status_code
    with ThreadPoolExecutor(max_workers=2) as pool:assert list(pool.map(post,range(2)))==[201,201]
    saved=db.orders.find_one({"_id":order["_id"]}); entries=saved.pop("inventoryInvestigations")
    assert len(entries)==2 and len({e["id"] for e in entries})==2 and all(e["unresolved"] for e in entries)
    assert saved==before and db.products.find_one({"_id":p["_id"]})==stock
    with app.test_client() as client:
        response=client.post(f"/api/staff/orders/{order['_id']}/inventory-investigations",headers=headers,
                             json={**payload,"supersedesId":entries[0]["id"]})
    assert response.status_code==201
    history=db.orders.find_one({"_id":order["_id"]})["inventoryInvestigations"]
    assert history[:2]==entries and history[-1]["supersedesId"]==entries[0]["id"]
    assert not db.whatsapp_outbox.find_one({"orderId":str(order["_id"])})


def test_investigation_permissions_and_operation_binding(inventory_sandbox,monkeypatch):
    from flask_jwt_extended import create_access_token
    box=inventory_sandbox;db=box["db"];p=_stock_product(box,4);order=_capture_order(box,[(p,1)])
    assert _run_crash_worker(box,order,"capture",1)==71
    app,headers,_=_minimal_staff_app(db,monkeypatch,box["track_user"])
    payload=investigation_payload(db,order);before=db.orders.find_one({"_id":order["_id"]})
    staff_id=ObjectId();db.users.insert_one({"_id":staff_id,"role":"staff","isActive":True,"permissions":["orders:manage"]});box["track_user"](staff_id)
    with app.app_context():token=create_access_token(identity=str(staff_id))
    path=f"/api/staff/orders/{order['_id']}/inventory-investigations"
    with app.test_client() as client:
        assert client.post(path,json=payload).status_code==401
        assert client.post(path,headers={"Authorization":"Bearer "+token},json=payload).status_code==403
        for bad in ({"operationId":"unrelated"},{"productId":str(ObjectId())},{"itemIndex":99},{"itemIndex":False},
                    {"externalStockCount":-1},{"supersedesId":"unrelated"},{"findings":"mongodb://secret:secret@private/"}):
            assert client.post(path,headers=headers,json={**payload,**bad}).status_code==400
    assert db.orders.find_one({"_id":order["_id"]})==before


@pytest.mark.parametrize("refund_status", ["partially_refunded","refunded"])
def test_recovery_never_promotes_refunded_payment(inventory_sandbox,monkeypatch,refund_status):
    box=inventory_sandbox;db=box["db"];p=_stock_product(box,4);order=_capture_order(box,[(p,1)])
    assert _run_crash_worker(box,order,"capture-before-final")==80
    amount=order["amountPaise"] if refund_status=="refunded" else 100
    proof={"id":"rfnd_synthetic","paymentId":order["_testCaptureId"],"amountPaise":amount,"currency":"INR",
           "source":"razorpay_signed_webhook","status":"processed","processedAt":datetime.now(timezone.utc)}
    db.orders.update_one({"_id":order["_id"]},{"$set":{"refunds":[proof],"payment.status":refund_status,"paymentStatus":refund_status}})
    before=db.orders.find_one({"_id":order["_id"]});stock=db.products.find_one({"_id":p["_id"]})
    app,headers,_=_minimal_staff_app(db,monkeypatch,box["track_user"])
    with app.test_client() as client:
        result=client.post(f"/api/staff/orders/{order['_id']}/inventory-reconciliation",headers=headers,
            json={"action":"reconcile_product_markers","reason":"Verify refunded capture must remain held"})
    assert result.status_code==409
    assert db.orders.find_one({"_id":order["_id"]})==before and db.products.find_one({"_id":p["_id"]})==stock


@pytest.mark.parametrize("damage", ["missing_capture", "wrong_currency", "wrong_amount", "status_only_refund"])
def test_recovery_requires_persisted_bound_capture_evidence(inventory_sandbox,monkeypatch,damage):
    box=inventory_sandbox;db=box["db"];p=_stock_product(box,4);order=_capture_order(box,[(p,1)])
    assert _run_crash_worker(box,order,"capture-before-final")==80
    changes={"missing_capture":{"captureEvidence":{}},"wrong_currency":{"captureEvidence.currency":"USD"},
             "wrong_amount":{"captureEvidence.amountPaise":1},"status_only_refund":{"payment.status":"partially_refunded"}}[damage]
    db.orders.update_one({"_id":order["_id"]},{"$set":changes})
    before=db.orders.find_one({"_id":order["_id"]})
    app,headers,_=_minimal_staff_app(db,monkeypatch,box["track_user"])
    with app.test_client() as client:
        response=client.post(f"/api/staff/orders/{order['_id']}/inventory-reconciliation",headers=headers,
            json={"action":"reconcile_product_markers","reason":"Review contradictory payment capture evidence"})
    assert response.status_code==409 and db.orders.find_one({"_id":order["_id"]})==before
    assert db.products.find_one({"_id":p["_id"]})["stock"]==3
