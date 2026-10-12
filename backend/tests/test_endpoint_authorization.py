import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from flask import Flask
from flask_jwt_extended import JWTManager, create_access_token

from app.blueprints.admin.routes import admin_bp
from bson import ObjectId
from app.blueprints.staff.routes import (
    _customer_scope,
    _document_view,
    _hydrate_created_variant_galleries,
    _management_collection_payload,
    _remove_media_relationship,
    _set_product_collections,
    _sync_variant_media_catalog,
    _variant_gallery_payload,
    staff_bp,
)
from app.workdrive import WorkDriveDownload


class TrackingUsers:
    def __init__(self, documents):
        self.documents = documents
        self.query = None

    def find(self, query):
        self.query = query
        return self

    def sort(self, *_args):
        return self.documents


class MutableCollection:
    def __init__(self, document):
        self.document = document

    def find_one(self, query, *_args, **_kwargs):
        if query.get("_id") == self.document.get("_id"):
            return self.document
        if query.get("slug") == self.document.get("slug"):
            return self.document
        return None

    def update_one(self, query, update):
        if query.get("_id") == self.document.get("_id"):
            self.document.update(update.get("$set", {}))
            for key in update.get("$unset", {}):
                self.document.pop(key, None)

    def insert_one(self, document):
        self.document = document
        self.document.setdefault("_id", ObjectId())
        return SimpleNamespace(inserted_id=self.document["_id"])

    def delete_one(self, query):
        if query.get("_id") == self.document.get("_id"):
            self.document = {}
            return SimpleNamespace(deleted_count=1)
        return SimpleNamespace(deleted_count=0)

    def find(self, *_args, **_kwargs):
        return Cursor([self.document])


class Cursor(list):
    def sort(self, *_args):
        return self

    def limit(self, count):
        return Cursor(self[:count])


class ProductDatabase:
    def __init__(self, document):
        self.products = MutableCollection(document)
        self.collections = SimpleNamespace(find=MagicMock(return_value=[]))
        self.inventory_adjustments = SimpleNamespace(insert_one=MagicMock())
        self.settings = SimpleNamespace(find_one=MagicMock(return_value={}), update_one=MagicMock())
        self.catalog_sync_outbox = SimpleNamespace(update_one=MagicMock())

    def __getitem__(self, name):
        return getattr(self, name)


class EndpointAuthorizationTests(unittest.TestCase):
    def setUp(self):
        app = Flask(__name__)
        app.config.update(TESTING=True, JWT_SECRET_KEY="test-secret-key-that-is-at-least-32-bytes")
        JWTManager(app)
        app.register_blueprint(staff_bp, url_prefix="/api/staff")
        app.register_blueprint(admin_bp, url_prefix="/api/admin")
        self.app = app
        self.client = app.test_client()
        with app.app_context():
            token = create_access_token(identity="000000000000000000000001")
        self.headers = {"Authorization": f"Bearer {token}"}

    def test_collection_workdrive_preview_requires_staff_and_validates_source(self):
        unauthenticated = self.client.post("/api/staff/collections/image-preview", json={"url": "https://workdrive.zoho.in/file/file123"})
        self.assertEqual(unauthenticated.status_code, 401)
        admin = {"_id": ObjectId(), "role": "admin", "isActive": True, "permissions": ["*"]}
        upstream = MagicMock(content=b"preview", headers={"Content-Type": "image/jpeg"})
        with patch("app.rbac.current_user", return_value=admin), \
             patch("app.blueprints.staff.routes.current_user", return_value=admin), \
             patch("app.blueprints.staff.routes.database", return_value=MagicMock()), \
             patch("app.blueprints.staff.routes.download_file", return_value=WorkDriveDownload(upstream, "file123")) as download:
            response = self.client.post("/api/staff/collections/image-preview", json={"url": "https://workdrive.zoho.in/file/file123"}, headers=self.headers)
            rejected = self.client.post("/api/staff/collections/image-preview", json={"url": "https://example.com/image.jpg"}, headers=self.headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content_type, "image/jpeg")
        self.assertEqual(rejected.status_code, 400)
        download.assert_called_once()

    def test_collection_creation_persists_empty_collection_and_verified_hero(self):
        admin = {"_id": ObjectId(), "role": "admin", "isActive": True, "permissions": ["*"]}
        collections = MutableCollection({})
        database = SimpleNamespace(collections=collections)
        payload = {"name": "Winter Edit", "slug": "winter-edit", "description": "An editorial collection.", "status": "draft", "hero": {"type": "image", "image": "https://workdrive.zoho.in/file/45kaa867c2b2ac8014d029e0d6cef5b83bf22", "layout": "editorial_split"}}
        with patch("app.rbac.current_user", return_value=admin), \
             patch("app.blueprints.staff.routes.current_user", return_value=admin), \
             patch("app.blueprints.staff.routes.database", return_value=database), \
             patch("app.blueprints.staff.routes._queue_collection_event") as queue_event, \
             patch("app.blueprints.staff.routes._management_collection_payload", side_effect=lambda _db, item: {"collection": {"id": str(item["_id"]), "slug": item["slug"], "hero": item["hero"], "productCount": len(item["productRefs"])}}):
            response = self.client.post("/api/staff/collections", json=payload, headers=self.headers)
        self.assertEqual(response.status_code, 201)
        self.assertEqual(collections.document["productRefs"], [])
        self.assertEqual(collections.document["hero"]["image"], payload["hero"]["image"])
        self.assertEqual(response.get_json()["collection"]["productCount"], 0)
        queue_event.assert_called_once()

    def test_collection_creation_rejects_invalid_or_duplicate_input(self):
        admin = {"_id": ObjectId(), "role": "admin", "isActive": True, "permissions": ["*"]}
        existing = {"_id": ObjectId(), "name": "Winter Edit", "slug": "winter-edit"}
        database = SimpleNamespace(collections=MutableCollection(existing))
        with patch("app.rbac.current_user", return_value=admin), patch("app.blueprints.staff.routes.current_user", return_value=admin), patch("app.blueprints.staff.routes.database", return_value=database):
            duplicate = self.client.post("/api/staff/collections", json={"name": "Winter Edit", "slug": "winter-edit", "hero": {"type": "image", "image": "https://workdrive.zoho.in/file/45kaa867c2b2ac8014d029e0d6cef5b83bf22", "layout": "editorial_split"}}, headers=self.headers)
            invalid = self.client.post("/api/staff/collections", json={"name": "Unsafe", "hero": {"type": "image", "image": "http://example.com/image.jpg", "layout": "editorial_split"}}, headers=self.headers)
        self.assertEqual(duplicate.status_code, 409)
        self.assertEqual(invalid.status_code, 400)

    def test_customer_cannot_call_staff_endpoint(self):
        customer = {"_id": "customer", "role": "customer", "isActive": True}
        with patch("app.rbac.current_user", return_value=customer):
            response = self.client.get("/api/staff/resources/products", headers=self.headers)
        self.assertEqual(response.status_code, 403)

    def test_variant_gallery_hydrates_canonical_relationship_id_and_staff_preview(self):
        product_id = ObjectId()
        permalink = "https://workdrive.zoho.in/file/red-1"
        relationship_id = "a" * 32
        product = {
            "_id": product_id,
            "catalogMedia": [{"id": relationship_id, "provider": "zoho_workdrive", "variant_id": "colour:red", "permalink": permalink, "position": 0}],
        }
        variant = {"id": "colour:red", "images": [permalink], "imageMeta": [{"id": "colour:red:new:123:0", "permalink": permalink, "position": 0}]}

        payload = _variant_gallery_payload(product, variant, "colour:red")

        self.assertEqual(payload["imageMeta"][0]["id"], relationship_id)
        self.assertEqual(payload["imageMeta"][0]["media_id"], relationship_id)
        self.assertEqual(payload["imageMeta"][0]["renderUrl"], f"/api/staff/products/{product_id}/media/{relationship_id}")

    def test_staff_media_preview_is_authorized_and_bound_to_product_relationship(self):
        product_id = ObjectId()
        relationship_id = "b" * 32
        permalink = "https://workdrive.zoho.in/file/red-1"
        document = {"_id": product_id, "catalogMedia": [{"id": relationship_id, "provider": "zoho_workdrive", "permalink": permalink}]}
        database = ProductDatabase(document)
        admin = {"_id": ObjectId(), "role": "admin", "isActive": True, "permissions": ["*"]}
        upstream = MagicMock(content=b"preview", headers={"Content-Type": "image/jpeg"})

        with patch("app.rbac.current_user", return_value=admin), \
             patch("app.blueprints.staff.routes.current_user", return_value=admin), \
             patch("app.blueprints.staff.routes.database", return_value=database), \
             patch("app.blueprints.staff.routes.download_file", return_value=WorkDriveDownload(upstream, "red-1")) as download:
            response = self.client.get(f"/api/staff/products/{product_id}/media/{relationship_id}", headers=self.headers)
            missing = self.client.get(f"/api/staff/products/{product_id}/media/{'c' * 32}", headers=self.headers)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content_type, "image/jpeg")
        self.assertEqual(missing.status_code, 404)
        download.assert_called_once_with(permalink, database, prefer_preview=True)

    def test_staff_without_capability_is_rejected(self):
        staff = {"_id": "staff", "role": "staff", "isActive": True, "permissions": []}
        with patch("app.rbac.current_user", return_value=staff), patch("app.blueprints.staff.routes.current_user", return_value=staff):
            response = self.client.get("/api/staff/resources/orders", headers=self.headers)
        self.assertEqual(response.status_code, 403)

    def test_staff_without_product_or_inventory_capability_cannot_list_collections(self):
        staff = {"_id": ObjectId(), "role": "staff", "isActive": True, "permissions": []}
        with patch("app.rbac.current_user", return_value=staff), patch("app.blueprints.staff.routes.current_user", return_value=staff):
            response = self.client.get("/api/staff/collections", headers=self.headers)
        self.assertEqual(response.status_code, 403)

    def test_staff_without_product_capability_cannot_change_variant_status(self):
        staff = {"_id": ObjectId(), "role": "staff", "isActive": True, "permissions": ["orders:manage"]}
        with patch("app.rbac.current_user", return_value=staff), patch("app.blueprints.staff.routes.current_user", return_value=staff):
            response = self.client.patch(
                f"/api/staff/products/{ObjectId()}/variants/colour:black",
                json={"status": "remove"},
                headers=self.headers,
            )
        self.assertEqual(response.status_code, 403)

    def test_staff_without_product_capability_cannot_delete_media_relationship(self):
        staff = {"_id": ObjectId(), "role": "staff", "isActive": True, "permissions": ["orders:manage"]}
        with patch("app.rbac.current_user", return_value=staff), patch("app.blueprints.staff.routes.current_user", return_value=staff):
            response = self.client.delete(
                f"/api/staff/products/{ObjectId()}/media/media-1",
                headers=self.headers,
            )
        self.assertEqual(response.status_code, 403)

    def test_removing_one_parent_relationship_preserves_other_parent_and_variant_media(self):
        product = {
            "_id": ObjectId(),
            "media": ["https://workdrive.zoho.in/file/parent-1", "https://workdrive.zoho.in/file/parent-2", "https://workdrive.zoho.in/file/parent-3"],
            "catalogMedia": [
                {"id": "parent-1", "provider": "zoho_workdrive", "permalink": "https://workdrive.zoho.in/file/parent-1"},
                {"id": "parent-2", "provider": "zoho_workdrive", "permalink": "https://workdrive.zoho.in/file/parent-2"},
                {"id": "parent-3", "provider": "zoho_workdrive", "permalink": "https://workdrive.zoho.in/file/parent-3"},
                {"id": "red-1", "provider": "zoho_workdrive", "permalink": "https://workdrive.zoho.in/file/red-1", "variant_id": "colour:red"},
            ],
            "variants": [
                {"id": "colour:red", "images": ["https://workdrive.zoho.in/file/red-1"], "imageMeta": [{"id": "red-source-1", "permalink": "https://workdrive.zoho.in/file/red-1"}]},
                {"id": "colour:blue", "images": [], "imageMeta": []},
            ],
        }

        updates = _remove_media_relationship(product, "parent-2")

        self.assertEqual([item["id"] for item in updates["catalogMedia"]], ["parent-1", "parent-3", "red-1"])
        self.assertEqual(updates["media"], ["https://workdrive.zoho.in/file/parent-1", "https://workdrive.zoho.in/file/parent-3"])
        self.assertNotIn("variants", updates)

    def test_removing_one_red_relationship_preserves_red_siblings_parent_media_and_blue(self):
        product = {
            "_id": ObjectId(),
            "media": ["https://workdrive.zoho.in/file/parent-1"],
            "catalogMedia": [{"id": "parent-1", "provider": "zoho_workdrive", "permalink": "https://workdrive.zoho.in/file/parent-1"}],
            "variants": [
                {"id": "colour:red", "colour": "red", "images": ["https://workdrive.zoho.in/file/red-1", "https://workdrive.zoho.in/file/red-2", "https://workdrive.zoho.in/file/red-3"], "imageMeta": [
                    {"id": "red-source-1", "permalink": "https://workdrive.zoho.in/file/red-1", "is_primary": True},
                    {"id": "red-source-2", "permalink": "https://workdrive.zoho.in/file/red-2"},
                    {"id": "red-source-3", "permalink": "https://workdrive.zoho.in/file/red-3"},
                ]},
                {"id": "colour:blue", "colour": "blue", "images": ["https://workdrive.zoho.in/file/blue-1"], "imageMeta": [{"id": "blue-source-1", "permalink": "https://workdrive.zoho.in/file/blue-1"}]},
            ],
        }
        product["catalogMedia"] = _sync_variant_media_catalog(product, product["variants"])
        red_ids = [item["id"] for item in product["catalogMedia"] if item.get("variant_id") == "colour:red"]

        updates = _remove_media_relationship(product, red_ids[1])

        red = next(item for item in updates["variants"] if item["id"] == "colour:red")
        blue = next(item for item in updates["variants"] if item["id"] == "colour:blue")
        self.assertEqual([item["id"] for item in red["imageMeta"]], ["red-source-1", "red-source-3"])
        self.assertEqual(blue["imageMeta"], product["variants"][1]["imageMeta"])
        self.assertEqual(updates["catalogMedia"][0]["id"], "parent-1")
        self.assertNotIn("media", updates)

    def test_authorized_media_delete_updates_one_relationship_and_queues_existing_delta(self):
        product_id = ObjectId()
        admin = {"_id": ObjectId(), "role": "admin", "isActive": True}
        document = {
            "_id": product_id,
            "name": "T1",
            "sku": "T1",
            "media": ["https://workdrive.zoho.in/file/parent-1", "https://workdrive.zoho.in/file/parent-2"],
            "catalogMedia": [
                {"id": "parent-1", "provider": "zoho_workdrive", "permalink": "https://workdrive.zoho.in/file/parent-1"},
                {"id": "parent-2", "provider": "zoho_workdrive", "permalink": "https://workdrive.zoho.in/file/parent-2"},
            ],
            "variants": [{"id": "colour:red", "images": [], "imageMeta": []}],
            "attributes": {},
        }
        database = ProductDatabase(document)

        with (
            patch("app.rbac.current_user", return_value=admin),
            patch("app.blueprints.staff.routes.current_user", return_value=admin),
            patch("app.blueprints.staff.routes.database", return_value=database),
            patch("app.blueprints.staff.routes._queue_media_delta") as queue_delta,
        ):
            response = self.client.delete(
                f"/api/staff/products/{product_id}/media/parent-1",
                headers=self.headers,
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["removedMediaId"], "parent-1")
        self.assertEqual([item["id"] for item in document["catalogMedia"]], ["parent-2"])
        self.assertEqual(document["media"], ["https://workdrive.zoho.in/file/parent-2"])
        queue_delta.assert_called_once()
        before, after = queue_delta.call_args.args[1:3]
        self.assertEqual([item["id"] for item in before["catalogMedia"]], ["parent-1", "parent-2"])
        self.assertEqual([item["id"] for item in after["catalogMedia"]], ["parent-2"])

    def test_customer_cannot_call_admin_endpoint(self):
        customer = {"_id": "customer", "role": "customer", "isActive": True}
        with patch("app.rbac.current_user", return_value=customer):
            response = self.client.get("/api/admin/users", headers=self.headers)
        self.assertEqual(response.status_code, 403)

    def test_admin_users_endpoint_returns_authoritative_user_directory(self):
        admin = {"_id": ObjectId(), "displayName": "Admin", "role": "admin", "isActive": True}
        staff = {"_id": ObjectId(), "displayName": "Staff", "role": "staff", "isActive": True}
        users = TrackingUsers([admin, staff])
        with patch("app.rbac.current_user", return_value=admin), patch("app.blueprints.admin.routes.database", return_value=SimpleNamespace(users=users)):
            response = self.client.get("/api/admin/users", headers=self.headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(users.query, {})
        self.assertEqual([user["role"] for user in response.get_json()["users"]], ["admin", "staff"])

    def test_staff_customer_scope_is_assignment_limited(self):
        staff_id = ObjectId()
        self.assertEqual(_customer_scope({"_id": staff_id, "role": "staff"}), {"role": "customer", "assignedStaffId": staff_id})

    def test_admin_customer_scope_is_not_assignment_limited(self):
        self.assertEqual(_customer_scope({"_id": ObjectId(), "role": "admin"}), {"role": "customer"})

    def test_product_creation_assigns_the_selected_collection(self):
        admin = {"_id": ObjectId(), "role": "admin", "isActive": True}
        collection_id = ObjectId()
        product_id = ObjectId()
        selected_collection = {"_id": collection_id, "name": "Hastakala", "slug": "hastakala", "productRefs": []}
        products = SimpleNamespace(
            find_one=MagicMock(return_value=None),
            insert_one=MagicMock(return_value=SimpleNamespace(inserted_id=product_id)),
        )
        collections = SimpleNamespace(
            find=MagicMock(side_effect=[[selected_collection], []]),
            update_one=MagicMock(),
        )
        database = SimpleNamespace(products=products, collections=collections)
        payload = {"name": "Perspire", "sku": "PER-01", "price": 12500, "stock": 1, "status": "active", "availability": "in_stock", "collectionId": str(collection_id)}

        with patch("app.rbac.current_user", return_value=admin), patch("app.blueprints.staff.routes.current_user", return_value=admin), patch("app.blueprints.staff.routes.database", return_value=database), patch("app.blueprints.staff.routes.sync_product_variants", side_effect=lambda _db, document: document):
            response = self.client.post("/api/staff/resources/products", json=payload, headers=self.headers)

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.get_json()["item"]["collections"], ["Hastakala"])
        reference = collections.update_one.call_args.args[1]["$push"]["productRefs"]
        self.assertEqual(reference["productId"], product_id)

    def test_product_creation_rejects_unknown_collection_before_insert(self):
        admin = {"_id": ObjectId(), "role": "admin", "isActive": True}
        products = SimpleNamespace(insert_one=MagicMock())
        database = SimpleNamespace(products=products, collections=SimpleNamespace(find=MagicMock(return_value=[])))
        payload = {"name": "Perspire", "sku": "PER-01", "price": 12500, "stock": 1, "collectionId": str(ObjectId())}

        with patch("app.rbac.current_user", return_value=admin), patch("app.blueprints.staff.routes.current_user", return_value=admin), patch("app.blueprints.staff.routes.database", return_value=database):
            response = self.client.post("/api/staff/resources/products", json=payload, headers=self.headers)

        self.assertEqual(response.status_code, 400)
        products.insert_one.assert_not_called()

    def test_product_creation_rejects_archived_collection_before_insert(self):
        admin = {"_id": ObjectId(), "role": "admin", "isActive": True}
        collection_id = ObjectId()
        products = SimpleNamespace(insert_one=MagicMock())
        archived = {"_id": collection_id, "name": "Archived", "status": "archived", "isActive": False}
        database = SimpleNamespace(products=products, collections=SimpleNamespace(find=MagicMock(return_value=[archived])))
        payload = {"name": "Perspire", "sku": "PER-01", "price": 12500, "stock": 0, "collectionId": str(collection_id)}

        with patch("app.rbac.current_user", return_value=admin), patch("app.blueprints.staff.routes.current_user", return_value=admin), patch("app.blueprints.staff.routes.database", return_value=database):
            response = self.client.post("/api/staff/resources/products", json=payload, headers=self.headers)

        self.assertEqual(response.status_code, 400)
        self.assertIn("Archived collections", response.get_json()["error"])
        products.insert_one.assert_not_called()

    def test_collection_archive_and_restore_preserve_product_references(self):
        admin = {"_id": ObjectId(), "role": "admin", "isActive": True, "permissions": ["*"]}
        product_id = ObjectId()
        collection = {"_id": ObjectId(), "name": "Sandook", "slug": "sandook", "status": "active", "isActive": True, "productRefs": [{"productId": product_id, "displayOrder": 3}]}
        collections = MutableCollection(collection)
        database = SimpleNamespace(collections=collections)

        with patch("app.rbac.current_user", return_value=admin), \
             patch("app.blueprints.staff.routes.current_user", return_value=admin), \
             patch("app.blueprints.staff.routes.database", return_value=database), \
             patch("app.blueprints.staff.routes._queue_collection_event"), \
             patch("app.blueprints.staff.routes._management_collection_payload", side_effect=lambda _db, item: {"collection": {"status": item.get("status"), "isActive": item.get("isActive")}}):
            archived = self.client.post("/api/staff/collections/sandook/archive", headers=self.headers)
            restored = self.client.post("/api/staff/collections/sandook/restore", headers=self.headers)

        self.assertEqual(archived.status_code, 200)
        self.assertEqual(archived.get_json()["collection"]["status"], "archived")
        self.assertEqual(restored.status_code, 200)
        self.assertEqual(restored.get_json()["collection"]["status"], "active")
        self.assertTrue(restored.get_json()["collection"]["isActive"])
        self.assertEqual(collection["productRefs"], [{"productId": product_id, "displayOrder": 3}])

    def test_archived_collection_delete_removes_only_collection_record(self):
        admin = {"_id": ObjectId(), "role": "admin", "isActive": True, "permissions": ["*"]}
        product_id = ObjectId()
        collection = {"_id": ObjectId(), "name": "Archived", "slug": "archived", "status": "archived", "isActive": False, "productRefs": [{"productId": product_id}]}
        collections = MutableCollection(collection)
        database = SimpleNamespace(collections=collections, products=MutableCollection({"_id": product_id, "name": "Still here"}))
        with patch("app.rbac.current_user", return_value=admin), patch("app.blueprints.staff.routes.current_user", return_value=admin), patch("app.blueprints.staff.routes.database", return_value=database), patch("app.blueprints.staff.routes._queue_collection_event") as queue_event:
            response = self.client.delete("/api/staff/collections/archived", headers=self.headers)
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.get_json()["deleted"])
        self.assertEqual(collections.document, {})
        self.assertEqual(database.products.document["name"], "Still here")
        queue_event.assert_called_once()

    def test_variant_save_uses_saved_identifier_and_missing_variant_is_not_500(self):
        product_id = ObjectId()
        product = {"_id": product_id, "name": "T1", "sku": "T1", "variants": [{"id": "colour:test", "images": [], "imageMeta": [], "status": "active"}], "catalogMedia": [], "attributes": {}}
        database = ProductDatabase(product)
        admin = {"_id": ObjectId(), "role": "admin", "isActive": True, "permissions": ["*"]}
        with patch("app.rbac.current_user", return_value=admin), patch("app.blueprints.staff.routes.current_user", return_value=admin), patch("app.blueprints.staff.routes.database", return_value=database), patch("app.blueprints.staff.routes.sync_product_variants", side_effect=lambda _db, value, **_kwargs: value):
            saved = self.client.patch(f"/api/staff/products/{product_id}/variants/colour:test", json={"images": [], "imageMeta": []}, headers=self.headers)
            missing = self.client.patch(f"/api/staff/products/{product_id}/variants/colour:missing", json={"images": [], "imageMeta": []}, headers=self.headers)
        self.assertEqual(saved.status_code, 200)
        self.assertEqual(missing.status_code, 404)

    def test_variant_hover_save_preserves_primary_and_returns_json(self):
        product_id = ObjectId()
        product = {"_id": product_id, "name": "T1", "sku": "T1", "variants": [{"id": "colour:test", "images": ["https://workdrive.zoho.in/file/45kaa867c2b2ac8014d029e0d6cef5b83bf22", "https://workdrive.zoho.in/file/45kaa5bb2ec1299cc4455a639950850e76546"], "imageMeta": [{"id": "a" * 32, "permalink": "https://workdrive.zoho.in/file/45kaa867c2b2ac8014d029e0d6cef5b83bf22", "is_primary": True, "is_hover": False}, {"id": "b" * 32, "permalink": "https://workdrive.zoho.in/file/45kaa5bb2ec1299cc4455a639950850e76546", "is_primary": False, "is_hover": False}], "status": "active"}], "catalogMedia": [], "attributes": {}}
        database = ProductDatabase(product)
        admin = {"_id": ObjectId(), "role": "admin", "isActive": True, "permissions": ["*"]}
        meta = [{"id": "a" * 32, "permalink": product["variants"][0]["images"][0], "is_primary": True, "is_hover": False}, {"id": "b" * 32, "permalink": product["variants"][0]["images"][1], "is_primary": False, "is_hover": True}]
        with patch("app.rbac.current_user", return_value=admin), patch("app.blueprints.staff.routes.current_user", return_value=admin), patch("app.blueprints.staff.routes.database", return_value=database), patch("app.blueprints.staff.routes.sync_product_variants", side_effect=lambda _db, value, **_kwargs: value):
            response = self.client.patch(f"/api/staff/products/{product_id}/variants/colour:test", json={"images": product["variants"][0]["images"], "imageMeta": meta}, headers=self.headers)
        self.assertEqual(response.status_code, 200)
        self.assertIsInstance(response.get_json(), dict)
        saved = database.products.document["variants"][0]["imageMeta"]
        self.assertTrue(saved[0]["is_primary"])
        self.assertTrue(saved[1]["is_hover"], saved)

    def test_created_variant_media_hydrates_only_its_stable_colour_gallery(self):
        red_id = "a" * 32
        product = {
            "variants": [
                {"id": "colour:red", "images": [], "imageMeta": []},
                {"id": "colour:blue", "images": [], "imageMeta": []},
            ],
            "catalogMedia": [
                {
                    "id": red_id,
                    "provider": "zoho_workdrive",
                    "variant_id": "colour:red",
                    "permalink": "https://workdrive.zoho.in/file/red-cover",
                    "position": 0,
                    "is_primary": True,
                    "is_hover": False,
                    "alt_text": "Red cover.jpg",
                }
            ],
        }

        hydrated = _hydrate_created_variant_galleries(product)

        self.assertEqual(hydrated["variants"][0]["images"], ["https://workdrive.zoho.in/file/red-cover"])
        self.assertEqual(hydrated["variants"][0]["imageMeta"][0]["id"], red_id)
        self.assertTrue(hydrated["variants"][0]["imageMeta"][0]["is_primary"])
        self.assertEqual(hydrated["variants"][1]["images"], [])
        self.assertEqual(hydrated["variants"][1]["imageMeta"], [])

    def test_product_collection_update_adds_and_removes_canonical_references(self):
        product_id = ObjectId()
        first = {"_id": ObjectId(), "name": "Aakaar", "productRefs": [{"productId": product_id, "displayOrder": 7}]}
        second = {"_id": ObjectId(), "name": "Hastakala", "productRefs": []}
        collections = SimpleNamespace(find=MagicMock(return_value=[first]), update_one=MagicMock())

        _set_product_collections(SimpleNamespace(collections=collections), product_id, [first, second])

        self.assertEqual(collections.update_one.call_count, 1)
        update = collections.update_one.call_args.args[1]
        self.assertEqual(update["$push"]["productRefs"]["productId"], product_id)
        self.assertEqual(first["productRefs"][0]["displayOrder"], 7)

        collections.find.return_value = [first, {**second, "productRefs": [{"productId": product_id, "displayOrder": 2}]}]
        collections.update_one.reset_mock()
        _set_product_collections(SimpleNamespace(collections=collections), product_id, [second])
        self.assertEqual(collections.update_one.call_count, 1)
        self.assertIn("$pull", collections.update_one.call_args.args[1])

    def test_product_update_persists_supported_fields_and_returns_full_admin_view(self):
        admin = {"_id": ObjectId(), "role": "admin", "isActive": True}
        product_id = ObjectId()
        document = {
            "_id": product_id,
            "name": "T1",
            "sku": "T1",
            "price": 101,
            "stock": 0,
            "status": "active",
            "availability": "in_stock",
            "category": "Couture",
            "description": "Original",
            "attributes": {"colors": ["red", "blue"], "fabric": "Silk"},
            "media": [],
            "catalogMedia": [],
            "variants": [],
        }
        database = ProductDatabase(document)
        payload = {
            "name": "T1 Revised",
            "price": 125,
            "availability": "custom_order",
            "category": "Eveningwear",
            "description": "Revised",
            "attributes": {"colors": ["red", "blue"], "fabric": "Cotton silk"},
        }

        with (
            patch("app.rbac.current_user", return_value=admin),
            patch("app.blueprints.staff.routes.current_user", return_value=admin),
            patch("app.blueprints.staff.routes.database", return_value=database),
            patch("app.blueprints.staff.routes.sync_product_variants", side_effect=lambda _db, item, force=False: item),
            patch("app.blueprints.staff.routes._queue_product_event"),
            patch("app.blueprints.staff.routes.enqueue_catalog_event"),
        ):
            response = self.client.patch(
                f"/api/staff/resources/products/{product_id}",
                json=payload,
                headers=self.headers,
            )

        self.assertEqual(response.status_code, 200)
        item = response.get_json()["item"]
        self.assertEqual(item["name"], "T1 Revised")
        self.assertEqual(item["price"], 125)
        self.assertEqual(item["availability"], "custom_order")
        self.assertEqual(item["attributes"]["fabric"], "Cotton silk")
        self.assertEqual(document["description"], "Revised")
        self.assertEqual(database.inventory_adjustments.insert_one.call_count, 0)

    def test_product_admin_view_preserves_descriptive_attributes(self):
        view = _document_view({
            "_id": ObjectId(),
            "sku": "T1",
            "availability": "in_stock",
            "attributes": {
                "sizes": ["M", "XL"],
                "colors": ["red", "blue"],
                "fabric": "Silk",
                "occasion": "Evening",
                "customizationInformation": "Available",
            },
        }, "products")

        self.assertEqual(view["attributes"]["fabric"], "Silk")
        self.assertEqual(view["attributes"]["occasion"], "Evening")
        self.assertEqual(view["attributes"]["customizationInformation"], "Available")

    def test_zero_quantity_size_options_do_not_require_an_inventory_reason(self):
        admin = {"_id": ObjectId(), "role": "admin", "isActive": True}
        product_id = ObjectId()
        document = {
            "_id": product_id,
            "name": "T1",
            "sku": "T1",
            "price": 101,
            "stock": 0,
            "status": "active",
            "availability": "in_stock",
            "attributes": {"sizes": []},
            "sizeInventoryConfigured": False,
            "sizeInventory": [],
            "media": [],
            "catalogMedia": [],
            "variants": [],
        }
        database = ProductDatabase(document)

        with (
            patch("app.rbac.current_user", return_value=admin),
            patch("app.blueprints.staff.routes.current_user", return_value=admin),
            patch("app.blueprints.staff.routes.database", return_value=database),
            patch("app.blueprints.staff.routes.sync_product_variants", side_effect=lambda _db, item, force=False: item),
            patch("app.blueprints.staff.routes._queue_product_event"),
        ):
            response = self.client.patch(
                f"/api/staff/resources/products/{product_id}",
                json={
                    "attributes": {"sizes": ["M", "XL"]},
                    "sizeInventoryConfigured": True,
                    "sizeInventory": [
                        {"size": "M", "stock": 0, "enabled": True},
                        {"size": "XL", "stock": 0, "enabled": True},
                    ],
                },
                headers=self.headers,
            )

        self.assertEqual(response.status_code, 200)
        adjustment = database.inventory_adjustments.insert_one.call_args.args[0]
        self.assertEqual(adjustment["reason"], "Product size options updated.")
        self.assertEqual(document["stock"], 0)

    def test_quantity_change_still_requires_an_explicit_reason(self):
        admin = {"_id": ObjectId(), "role": "admin", "isActive": True}
        product_id = ObjectId()
        document = {
            "_id": product_id,
            "name": "T1",
            "sku": "T1",
            "stock": 0,
            "availability": "in_stock",
            "attributes": {},
            "media": [],
            "catalogMedia": [],
            "variants": [],
        }
        database = ProductDatabase(document)

        with (
            patch("app.rbac.current_user", return_value=admin),
            patch("app.blueprints.staff.routes.current_user", return_value=admin),
            patch("app.blueprints.staff.routes.database", return_value=database),
        ):
            response = self.client.patch(
                f"/api/staff/resources/products/{product_id}",
                json={"stock": 1},
                headers=self.headers,
            )

        self.assertEqual(response.status_code, 400)
        self.assertIn("reason", response.get_json()["error"].lower())
        database.inventory_adjustments.insert_one.assert_not_called()

    def test_management_collection_uses_authoritative_parent_product_values(self):
        product_id = ObjectId()
        document = {
            "_id": product_id,
            "name": "T1 Revised",
            "sku": "T1",
            "price": 125,
            "stock": 0,
            "status": "active",
            "availability": "custom_order",
            "attributes": {"colors": ["red", "blue"], "fabric": "Cotton silk"},
            "media": [],
            "catalogMedia": [
                {"id": "legacy-null", "permalink": "https://workdrive.zoho.in/file/legacy-null", "position": None},
                {"id": "legacy-text", "permalink": "https://workdrive.zoho.in/file/legacy-text", "position": "legacy"},
            ],
            "variants": [{"id": "colour:red", "sku": "SK-T1-RED", "colour": "red", "status": "active"}],
        }
        database = ProductDatabase(document)
        public_detail = {
            "id": str(ObjectId()),
            "products": [{
                "id": str(product_id),
                "name": "T1 Revised",
                "sku": "SK-T1-RED",
                "price": 101,
                "availability": "in_stock",
                "attributes": {"colors": ["red", "blue"]},
                "displayOrder": 3,
            }],
        }

        with (
            patch("app.blueprints.staff.routes.collection_view", side_effect=[public_detail]),
            patch("app.blueprints.staff.routes.product_collection_ids", return_value=["collection-1"]),
            patch("app.blueprints.staff.routes.managed_collections", return_value=[]),
            patch("app.blueprints.staff.routes.effective_permissions", return_value=["products:manage"]),
            patch("app.blueprints.staff.routes.current_user", return_value={"role": "admin"}),
        ):
            payload = _management_collection_payload(database, {"_id": ObjectId()})

        managed = payload["collection"]["products"][0]
        self.assertEqual(managed["sku"], "T1")
        self.assertEqual(managed["price"], 125)
        self.assertEqual(managed["availability"], "custom_order")
        self.assertEqual(managed["attributes"]["fabric"], "Cotton silk")
        self.assertEqual(managed["displayOrder"], 3)
        self.assertEqual(len(managed["media"]), 2)


if __name__ == "__main__":
    unittest.main()
