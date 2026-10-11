import unittest
from copy import deepcopy
from types import SimpleNamespace

import mongomock
from bson import ObjectId

from app.catalog_sync_v1 import EVENT_TYPES, CatalogEventError, apply_incoming, complete, enqueue, make_event, manifest, queue_repair_events, rejection_ack, validate_event
from app.blueprints.staff.routes import _normalize_catalog_media, _queue_media_delta, _sync_variant_media_catalog


class Collection:
    def __init__(self): self.documents = []
    def _match(self, document, query):
        for key, value in query.items():
            if isinstance(value, dict) and "$lte" in value:
                if document.get(key) is None or document[key] > value["$lte"]: return False
            elif isinstance(value, dict) and "$in" in value:
                if document.get(key) not in value["$in"]: return False
            elif document.get(key) != value: return False
        return True
    def find_one(self, query, *_args):
        return next((deepcopy(item) for item in self.documents if self._match(item, query)), None)
    def find(self, query=None, *_args):
        return [deepcopy(item) for item in self.documents if self._match(item, query or {})]
    def insert_one(self, document):
        stored = deepcopy(document); stored.setdefault("_id", ObjectId()); self.documents.append(stored)
        return SimpleNamespace(inserted_id=stored["_id"])
    def update_one(self, query, update, upsert=False):
        target = next((item for item in self.documents if self._match(item, query)), None)
        if target is None and upsert:
            target = {key: value for key, value in query.items() if not isinstance(value, dict)}; self.documents.append(target)
        if target is None: return SimpleNamespace(modified_count=0)
        for key, value in update.get("$set", {}).items(): target[key] = deepcopy(value)
        for key, value in update.get("$setOnInsert", {}).items(): target.setdefault(key, deepcopy(value))
        for key in update.get("$unset", {}): target.pop(key, None)
        return SimpleNamespace(modified_count=1)
    def create_index(self, *_args, **_kwargs): return "index"


class Database:
    def __init__(self):
        for name in ("products", "collections", "settings", "catalog_sync_identities", "catalog_sync_outbox", "catalog_applied_events", "catalog_sync_conflicts", "catalog_sync_logs"):
            setattr(self, name, Collection())


def stock_event(event_type="PRODUCT_CREATED", version=1, observed=None, payload=None):
    event = make_event(event_type, "product", "stock-1", version, payload or {"sku": "CK-301", "name": "CK-301", "price": 1000, "active": True})
    event.update({"source_system": "rk-stock", "source_id": "stock-1", "entity_identity": {"origin_system": "rk-stock", "origin_id": "stock-1"}, "observed_versions": observed or {"rk-stock": version, "rk-web": 0}})
    return event


class CatalogSyncContractTests(unittest.TestCase):
    def test_every_approved_event_type_uses_one_envelope(self):
        entity_for = lambda event_type: "product_collection" if event_type == "PRODUCT_COLLECTION_CHANGED" else "media" if event_type.startswith("MEDIA_") else event_type.split("_", 1)[0].lower()
        for event_type in EVENT_TYPES:
            with self.subTest(event_type=event_type):
                payload = {"media_id": "m1", "provider": "cloudinary", "public_id": "rk/m1", "position": 0, "is_primary": True, "owner_system": "rk-web"} if event_type.startswith("MEDIA_") else {}
                event = make_event(event_type, entity_for(event_type), "local-1", 1, payload)
                self.assertEqual(validate_event(event)["schema_version"], "catalog.sync.v1")

    def test_invalid_and_operational_payloads_are_rejected(self):
        with self.assertRaises(CatalogEventError): validate_event({})
        with self.assertRaises(CatalogEventError): make_event("PRODUCT_UPDATED", "product", "one", 1, {"stock": 99})

    def test_media_contract_preserves_provider_identity_and_workdrive_permalink(self):
        cloudinary = {"media_id": "cloud-1", "provider": "cloudinary", "type": "image", "public_id": "rk/ck301", "secure_url": "https://res.cloudinary.com/rk/image/upload/ck301.jpg", "position": 0, "is_primary": True, "owner_system": "rk-web", "product_identity": {"origin_system": "rk-web", "origin_id": "p1"}}
        workdrive = {"media_id": "wd-1", "provider": "zoho_workdrive", "type": "image", "permalink": "https://workdrive.zoho.in/file/abc", "position": 1, "is_primary": False, "owner_system": "rk-stock", "product_identity": {"origin_system": "rk-stock", "origin_id": "p2"}}
        validate_event(make_event("MEDIA_CREATED", "media", "cloud-1", 1, cloudinary))
        validate_event(make_event("MEDIA_UPDATED", "media", "wd-1", 1, workdrive))
        with self.assertRaises(CatalogEventError):
            validate_event(make_event("MEDIA_UPDATED", "media", "wd-2", 1, {**workdrive, "media_id": "wd-2", "permalink": "https://workdrive.zoho.in/embed/abc"}))
        with self.assertRaises(CatalogEventError):
            validate_event(make_event("MEDIA_UPDATED", "media", "wd-3", 1, {**workdrive, "media_id": "wd-3", "permalink": "https://evil.example/file/abc"}))

    def test_colour_gallery_uses_stable_variant_identity_and_switches_independently(self):
        product = {"catalogMedia": [], "variants": []}
        variants = [
            {"id": "colour:red", "colour": "Red", "colourSlug": "red", "images": ["https://workdrive.zoho.in/file/red-1"]},
            {"id": "colour:blue", "colour": "Blue", "colourSlug": "blue", "images": ["https://workdrive.zoho.in/file/blue-1", "https://workdrive.zoho.in/file/blue-2"]},
        ]
        media = _sync_variant_media_catalog(product, variants)
        self.assertEqual([item["variant_id"] for item in media], ["colour:red", "colour:blue", "colour:blue"])
        self.assertEqual([item["colour_slug"] for item in media], ["red", "blue", "blue"])
        self.assertEqual(len({item["id"] for item in media}), 3)
        self.assertEqual(_sync_variant_media_catalog(product, variants), media)

    def test_outbox_is_metadata_only_and_idempotent(self):
        db = Database(); event = make_event("PRODUCT_CREATED", "product", "web-1", 1, {"sku": "WEB-1", "name": "Web product"})
        enqueue(db, event); enqueue(db, event)
        self.assertEqual(len(db.catalog_sync_outbox.documents), 1)
        self.assertNotIn("stock", db.catalog_sync_outbox.documents[0]["payload"])

    def test_receiver_conflict_is_terminal_not_retried(self):
        db = Database(); event = enqueue(db, make_event("PRODUCT_UPDATED", "product", "web-1", 1, {"sku": "WEB-1"}))
        stored = db.catalog_sync_outbox.documents[0]; stored.setdefault("_id", ObjectId()); stored["lease_id"] = "worker-1"; event = deepcopy(stored)
        self.assertTrue(complete(db, event, "CONFLICT"))
        self.assertEqual(db.catalog_sync_outbox.documents[0]["status"], "conflict")

    def test_apply_duplicate_stale_and_conflict(self):
        db = Database(); event = stock_event()
        ack, code = apply_incoming(db, event)
        self.assertEqual((ack["status"], code), ("APPLIED", 200))
        self.assertEqual(ack["schema_version"], event["schema_version"])
        self.assertEqual(ack["event_id"], event["event_id"])
        self.assertEqual(ack["entity_type"], event["entity_type"])
        self.assertEqual(ack["source_id"], event["source_id"])
        self.assertEqual(ack["entity_version"], event["entity_version"])
        self.assertTrue(ObjectId.is_valid(ack["local_entity_id"]))
        duplicate, code = apply_incoming(db, event)
        self.assertEqual((duplicate["status"], code), ("ALREADY_APPLIED", 200))
        self.assertEqual(duplicate["local_entity_id"], ack["local_entity_id"])
        stale, code = apply_incoming(db, stock_event(version=1))
        self.assertEqual((stale["status"], code), ("STALE", 200))
        self.assertEqual(stale["local_entity_id"], ack["local_entity_id"])
        mapping = db.catalog_sync_identities.documents[0]; mapping["versions"]["rk-web"] = 3
        conflict, code = apply_incoming(db, stock_event(version=2, observed={"rk-stock": 2, "rk-web": 1}))
        self.assertEqual((conflict["status"], code), ("CONFLICT", 409))
        self.assertEqual(len(db.catalog_sync_conflicts.documents), 1)

    def test_unmapped_media_rejection_is_correlated_without_applying(self):
        db = Database()
        event = make_event("MEDIA_CREATED", "media", "orphan-media", 1, {
            "media_id": "orphan-media", "provider": "zoho_workdrive",
            "owner_system": "rk-stock", "permalink": "https://workdrive.zoho.in/file/orphan",
            "position": 0, "is_primary": False,
            "product_identity": {"origin_system": "rk-web", "origin_id": "missing-web-product"},
        })
        event.update({"source_system": "rk-stock", "source_id": "orphan-media", "entity_identity": {"origin_system": "rk-stock", "origin_id": "orphan-media"}})
        with self.assertRaises(CatalogEventError):
            apply_incoming(db, event)
        acknowledgement = rejection_ack(event, "Mapped product is required before relationship events.")
        self.assertEqual(acknowledgement["status"], "INVALID")
        for key in ("schema_version", "event_id", "entity_type", "source_id", "entity_version"):
            self.assertEqual(acknowledgement[key], event[key])
        self.assertEqual(acknowledgement["message"], "Mapped product is required before relationship events.")

    def test_stock_product_is_stored_locally_without_operational_fields(self):
        db = Database(); event = stock_event(payload={"sku": "CK-301", "name": "CK-301", "description": "Local storefront copy", "price": 1200, "category": "Couture", "active": True})
        ack, _ = apply_incoming(db, event)
        product = db.products.documents[0]
        self.assertEqual(ack["status"], "APPLIED")
        self.assertEqual(product["source_system"], "rk-stock")
        self.assertNotIn("stock", product)

    def test_reconciliation_queues_product_collection_membership_and_media_once(self):
        db = Database(); product_id = ObjectId(); collection_id = ObjectId()
        product_identity = {"origin_system": "rk-web", "origin_id": "web-product-1"}
        collection_identity = {"origin_system": "rk-web", "origin_id": "web-collection-1"}
        db.products.insert_one({"_id": product_id, "sku": "WEB-1", "name": "Web one", "isActive": True, "catalogMedia": [{"media_id": "media-1", "provider": "cloudinary", "owner_system": "rk-web", "public_id": "rk/media-1", "position": 0, "is_primary": True}]})
        db.collections.insert_one({"_id": collection_id, "name": "Collection", "isActive": True, "productRefs": [{"productId": product_id, "displayOrder": 4}]})
        db.catalog_sync_identities.insert_one({"entity_type": "product", **product_identity, "rk_web_id": str(product_id), "versions": {"rk-web": 2, "rk-stock": 0}})
        db.catalog_sync_identities.insert_one({"entity_type": "collection", **collection_identity, "rk_web_id": str(collection_id), "versions": {"rk-web": 2, "rk-stock": 0}})
        entries = manifest(db)["items"]
        self.assertTrue(any(item["entity_type"] == "product_collection" and item["payload"]["display_order"] == 4 for item in entries))
        self.assertTrue(any(item["entity_type"] == "media" and item["payload"]["public_id"] == "rk/media-1" for item in entries))
        first = queue_repair_events(db, [])
        second = queue_repair_events(db, [])
        self.assertEqual({event["event_type"] for event in first}, {"PRODUCT_CREATED", "COLLECTION_CREATED", "PRODUCT_COLLECTION_CHANGED", "MEDIA_CREATED"})
        self.assertEqual(second, [])
        self.assertEqual(len(db.catalog_sync_outbox.documents), 4)
        for event in db.catalog_sync_outbox.documents: event["status"] = "completed"
        self.assertEqual(queue_repair_events(db, []), [])
        for event in db.catalog_sync_outbox.documents:
            self.assertFalse({"stock", "physical_stock", "reserved_stock", "available_stock", "orders", "payments"}.intersection(event["payload"]))

    def test_stock_membership_and_media_repairs_apply_once(self):
        db = mongomock.MongoClient().test; product_id = ObjectId(); collection_id = ObjectId()
        db.products.insert_one({"_id": product_id, "name": "Product", "catalogMedia": []})
        db.collections.insert_one({"_id": collection_id, "name": "Collection", "productRefs": []})
        db.catalog_sync_identities.insert_many([
            {"entity_type": "product", "origin_system": "rk-stock", "origin_id": "stock-product", "rk_web_id": str(product_id), "versions": {"rk-stock": 1, "rk-web": 0}},
            {"entity_type": "collection", "origin_system": "rk-stock", "origin_id": "stock-collection", "rk_web_id": str(collection_id), "versions": {"rk-stock": 1, "rk-web": 0}},
        ])
        membership = make_event("PRODUCT_COLLECTION_CHANGED", "product_collection", "membership-1", 2, {"product_identity": {"origin_system": "rk-stock", "origin_id": "stock-product"}, "changes": [{"operation": "ADD", "collection_identity": {"origin_system": "rk-stock", "origin_id": "stock-collection"}, "display_order": 7}]}, observed_versions={"rk-stock": 2, "rk-web": 0}, identity={"origin_system": "rk-stock", "origin_id": "membership-1"})
        membership["source_system"] = "rk-stock"
        self.assertEqual(apply_incoming(db, membership)[0]["status"], "APPLIED")
        self.assertEqual(apply_incoming(db, membership)[0]["status"], "ALREADY_APPLIED")
        refs = db.collections.find_one({"_id": collection_id})["productRefs"]
        self.assertEqual(refs, [{"productId": product_id, "displayOrder": 7}])
        media_payload = {"media_id": "cloud-1", "provider": "cloudinary", "owner_system": "rk-stock", "public_id": "rk/cloud-1", "position": 0, "is_primary": True, "product_identity": {"origin_system": "rk-stock", "origin_id": "stock-product"}}
        media = make_event("MEDIA_CREATED", "media", "cloud-1", 2, media_payload, observed_versions={"rk-stock": 2, "rk-web": 0}, identity={"origin_system": "rk-stock", "origin_id": "cloud-1"}); media["source_system"] = "rk-stock"
        self.assertEqual(apply_incoming(db, media)[0]["status"], "APPLIED")
        self.assertEqual(apply_incoming(db, media)[0]["status"], "ALREADY_APPLIED")
        stored = db.products.find_one({"_id": product_id})["catalogMedia"]
        self.assertEqual(len(stored), 1); self.assertEqual(stored[0]["public_id"], "rk/cloud-1"); self.assertTrue(stored[0]["is_primary"])
        changed = {**media_payload, "position": 3, "is_primary": False, "description": "Updated"}
        update = make_event("MEDIA_REORDERED", "media", "cloud-1", 3, changed, observed_versions={"rk-stock": 3, "rk-web": 0}, identity={"origin_system": "rk-stock", "origin_id": "cloud-1"}); update["source_system"] = "rk-stock"
        self.assertEqual(apply_incoming(db, update)[0]["status"], "APPLIED")
        stored = db.products.find_one({"_id": product_id})["catalogMedia"]
        self.assertEqual(len(stored), 1); self.assertEqual(stored[0]["position"], 3); self.assertFalse(stored[0]["is_primary"]); self.assertEqual(stored[0]["description"], "Updated")
        removed_payload = {**changed, "owner_system": "rk-stock"}
        removed = make_event("MEDIA_DELETED", "media", "cloud-1", 4, removed_payload, observed_versions={"rk-stock": 4, "rk-web": 0}, identity={"origin_system": "rk-stock", "origin_id": "cloud-1"}); removed["source_system"] = "rk-stock"
        self.assertEqual(apply_incoming(db, removed)[0]["status"], "APPLIED")
        self.assertEqual(db.products.find_one({"_id": product_id})["catalogMedia"], [])
        self.assertEqual(queue_repair_events(db, manifest(db)["items"]), [])

    def test_web_product_document_media_delta_queues_create_and_delete(self):
        db = mongomock.MongoClient().test
        product_id = ObjectId()
        media = {"id": "wd-web-1", "provider": "zoho_workdrive", "owner_system": "rk-web", "permalink": "https://workdrive.zoho.in/file/photo-one", "url": "https://workdrive.zoho.in/file/photo-one", "type": "image", "position": 0, "is_primary": True}
        product = {"_id": product_id, "catalogMedia": [media], "catalogVersions": {"rk-web": 1, "rk-stock": 0}}
        db.products.insert_one(product)
        created = _queue_media_delta(db, {"catalogMedia": []}, product)
        self.assertEqual([event["event_type"] for event in created], ["MEDIA_CREATED"])
        self.assertEqual(created[0]["payload"]["product_identity"]["origin_id"], str(product_id))
        removed = _queue_media_delta(db, product, {**product, "catalogMedia": []})
        self.assertEqual([event["event_type"] for event in removed], ["MEDIA_DELETED"])
        self.assertEqual(db.catalog_sync_outbox.count_documents({"entity_type": "media"}), 2)

    def test_workdrive_media_normalization_orders_and_rejects_unsafe_links(self):
        structured, legacy = _normalize_catalog_media(["https://workdrive.zoho.in/file/first", "https://workdrive.zohoexternal.in/file/second"])
        self.assertEqual(legacy, ["https://workdrive.zoho.in/file/first", "https://workdrive.zohoexternal.in/file/second"])
        self.assertEqual([item["position"] for item in structured], [0, 1])
        self.assertEqual([item["is_primary"] for item in structured], [True, False])
        preserved, _ = _normalize_catalog_media([{"media_id": "stock-owned", "provider": "zoho_workdrive", "owner_system": "rk-stock", "permalink": "https://workdrive.zoho.in/file/preserved"}])
        self.assertEqual((preserved[0]["id"], preserved[0]["owner_system"]), ("stock-owned", "rk-stock"))
        for invalid in ("http://workdrive.zoho.in/file/insecure", "https://user@workdrive.zoho.in/file/secret", "https://workdrive.zoho.in/file/fragment#preview", "https://evil.example/file/not-approved"):
            with self.assertRaises(ValueError):
                _normalize_catalog_media([{"provider": "zoho_workdrive", "permalink": invalid}])

    def test_media_contract_preserves_optional_hover_state(self):
        structured, _ = _normalize_catalog_media([{
            "provider": "zoho_workdrive",
            "permalink": "https://workdrive.zoho.in/file/hover",
            "is_hover": True,
        }])
        self.assertTrue(structured[0]["is_hover"])

    def test_stock_category_repair_and_ambiguous_authority_conflict(self):
        db = mongomock.MongoClient().test
        category = make_event("CATEGORY_CREATED", "category", "stock-category", 1, {"name": "Couture", "slug": "couture", "active": True}, observed_versions={"rk-stock": 1, "rk-web": 0}, identity={"origin_system": "rk-stock", "origin_id": "stock-category"}); category["source_system"] = "rk-stock"
        self.assertEqual(apply_incoming(db, category)[0]["status"], "APPLIED")
        self.assertEqual(apply_incoming(db, category)[0]["status"], "ALREADY_APPLIED")
        stored = db.settings.find_one({"_id": "global"})["catalog_source_categories"]
        self.assertEqual(len(stored), 1); self.assertEqual(stored[0]["name"], "Couture")
        self.assertEqual(queue_repair_events(db, [{"entity_type": "product", "payload": {"name": "Unknown"}}]), [])
        self.assertEqual(db.catalog_sync_conflicts.count_documents({"reason": "ambiguous_reconciliation_authority"}), 1)
        queue_repair_events(db, [{"entity_type": "product", "payload": {"name": "Unknown"}}])
        self.assertEqual(db.catalog_sync_conflicts.count_documents({"reason": "ambiguous_reconciliation_authority"}), 1)


if __name__ == "__main__": unittest.main()
