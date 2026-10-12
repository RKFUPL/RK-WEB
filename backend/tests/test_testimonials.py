import unittest
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import patch

from bson import ObjectId
from flask import Flask
from flask_jwt_extended import JWTManager, create_access_token

from app.blueprints.admin.routes import admin_bp
from app.blueprints.content.routes import content_bp
from app.workdrive import WorkDriveDownload, WorkDriveUnavailable


class Cursor(list):
    def sort(self, fields):
        values = list(self)
        for field, direction in reversed(fields):
            values.sort(key=lambda item: item.get(field) or datetime.min.replace(tzinfo=timezone.utc), reverse=direction < 0)
        return Cursor(values)


class FakeTestimonialCollection:
    def __init__(self, documents=None):
        self.documents = [dict(item) for item in (documents or [])]

    def find(self, query):
        return Cursor([item for item in self.documents if all(item.get(key) == value for key, value in query.items())])

    def find_one(self, query):
        return next((item for item in self.documents if all(item.get(key) == value for key, value in query.items())), None)

    def insert_one(self, document):
        stored = dict(document, _id=ObjectId())
        self.documents.append(stored)
        return SimpleNamespace(inserted_id=stored["_id"])

    def update_one(self, query, update):
        item = self.find_one(query)
        if not item:
            return SimpleNamespace(matched_count=0)
        item.update(update.get("$set", {}))
        return SimpleNamespace(matched_count=1)

    def delete_one(self, query):
        item = self.find_one(query)
        if not item:
            return SimpleNamespace(deleted_count=0)
        self.documents.remove(item)
        return SimpleNamespace(deleted_count=1)


class TestimonialApiTests(unittest.TestCase):
    def setUp(self):
        app = Flask(__name__)
        app.config.update(TESTING=True, JWT_SECRET_KEY="testimonial-test-secret-at-least-32-bytes")
        JWTManager(app)
        app.register_blueprint(admin_bp, url_prefix="/api/admin")
        app.register_blueprint(content_bp, url_prefix="/api/content")
        self.client = app.test_client()
        with app.app_context():
            self.token = create_access_token(identity=str(ObjectId()))
        self.headers = {"Authorization": f"Bearer {self.token}"}
        self.admin = {"_id": ObjectId(), "role": "admin", "isActive": True}
        self.database = SimpleNamespace(testimonials=FakeTestimonialCollection())

    def admin_context(self):
        return (
            patch("app.rbac.current_user", return_value=self.admin),
            patch("app.blueprints.admin.routes.current_user", return_value=self.admin),
            patch("app.blueprints.admin.routes.database", return_value=self.database),
        )

    def test_admin_crud_and_public_filtering(self):
        with self.admin_context()[0], self.admin_context()[1], self.admin_context()[2]:
            created = self.client.post("/api/admin/testimonials", headers=self.headers, json={
                "displayName": "Approved client", "text": "A considered fitting experience.", "status": "draft", "displayOrder": 2,
            })
        self.assertEqual(created.status_code, 201)
        item_id = created.get_json()["item"]["id"]

        with patch("app.blueprints.content.routes.database", return_value=self.database):
            self.assertEqual(self.client.get("/api/content/testimonials").get_json()["items"], [])

        with self.admin_context()[0], self.admin_context()[1], self.admin_context()[2]:
            updated = self.client.patch(f"/api/admin/testimonials/{item_id}", headers=self.headers, json={"status": "published"})
        self.assertEqual(updated.status_code, 200)

        with patch("app.blueprints.content.routes.database", return_value=self.database):
            public = self.client.get("/api/content/testimonials").get_json()["items"]
        self.assertEqual([item["displayName"] for item in public], ["Approved client"])
        self.assertNotIn("relatedProductId", public[0])

        with self.admin_context()[0], self.admin_context()[1], self.admin_context()[2]:
            deleted = self.client.delete(f"/api/admin/testimonials/{item_id}", headers=self.headers)
        self.assertEqual(deleted.status_code, 200)
        self.assertEqual(self.database.testimonials.documents, [])

    def test_writes_require_admin_and_validate_content(self):
        customer = {"_id": ObjectId(), "role": "customer", "isActive": True}
        existing_id = ObjectId()
        self.database.testimonials.documents.append({"_id": existing_id, "displayName": "Existing", "text": "Text", "status": "draft"})
        with patch("app.rbac.current_user", return_value=customer):
            denied_list = self.client.get("/api/admin/testimonials", headers=self.headers)
            denied = self.client.post("/api/admin/testimonials", headers=self.headers, json={"displayName": "Name", "text": "Text"})
            denied_update = self.client.patch(f"/api/admin/testimonials/{existing_id}", headers=self.headers, json={"status": "published"})
            denied_delete = self.client.delete(f"/api/admin/testimonials/{existing_id}", headers=self.headers)
        self.assertEqual(denied_list.status_code, 403)
        self.assertEqual(denied.status_code, 403)
        self.assertEqual(denied_update.status_code, 403)
        self.assertEqual(denied_delete.status_code, 403)

        with self.admin_context()[0], self.admin_context()[1], self.admin_context()[2]:
            invalid = self.client.post("/api/admin/testimonials", headers=self.headers, json={"displayName": "", "text": ""})
            private_image = self.client.post("/api/admin/testimonials", headers=self.headers, json={
                "displayName": "Name", "text": "Text", "imageUrl": "https://workdrive.zoho.in/file/private",
            })
        self.assertEqual(invalid.status_code, 400)
        self.assertEqual(private_image.status_code, 400)
        self.assertEqual(len(self.database.testimonials.documents), 1)
        self.assertEqual(self.database.testimonials.documents[0]["_id"], existing_id)

    def test_public_testimonials_are_published_only_and_ordered(self):
        now = datetime.now(timezone.utc)
        self.database.testimonials.documents.extend([
            {"_id": ObjectId(), "displayName": "Later", "text": "Later", "status": "published", "displayOrder": 20, "createdAt": now},
            {"_id": ObjectId(), "displayName": "Private", "text": "Private", "status": "draft", "displayOrder": 0, "createdAt": now},
            {"_id": ObjectId(), "displayName": "First", "text": "First", "status": "published", "displayOrder": 1, "createdAt": now},
        ])

        with patch("app.blueprints.content.routes.database", return_value=self.database):
            response = self.client.get("/api/content/testimonials")

        self.assertEqual(response.status_code, 200)
        self.assertEqual([item["displayName"] for item in response.get_json()["items"]], ["First", "Later"])

    def test_managed_workdrive_image_is_stored_and_public_response_uses_proxy(self):
        permalink = "https://workdrive.zoho.in/file/45kaa867c2b2ac8014d029e0d6cef5b83bf22"
        with self.admin_context()[0], self.admin_context()[1], self.admin_context()[2]:
            response = self.client.post("/api/admin/testimonials", headers=self.headers, json={
                "displayName": "Managed portrait", "text": "A genuine testimonial.", "status": "published",
                "imageMedia": {"provider": "zoho_workdrive", "permalink": permalink},
            })
        self.assertEqual(response.status_code, 201)
        stored = self.database.testimonials.documents[0]
        self.assertEqual(stored["imageMedia"]["provider"], "zoho_workdrive")
        self.assertEqual(stored["imageMedia"]["permalink"], permalink)
        self.assertIsNone(stored["imageUrl"])

        with patch("app.blueprints.content.routes.database", return_value=self.database):
            item = self.client.get("/api/content/testimonials").get_json()["items"][0]
        self.assertEqual(item["imageUrl"], f"/api/content/testimonials/{stored['_id']}/image")
        self.assertNotIn("workdrive.zoho.in", str(item))

    def test_external_workdrive_share_is_accepted_but_lookalikes_and_malformed_links_are_rejected(self):
        external = "https://workdrive.zohoexternal.in/external/063dad8186a865231e618d65da727a6dcb1cc1729623dbf26ba222ae8b3e865d"
        with self.admin_context()[0], self.admin_context()[1], self.admin_context()[2]:
            accepted = self.client.post("/api/admin/testimonials", headers=self.headers, json={
                "displayName": "External share", "text": "Text", "status": "draft",
                "imageMedia": {"provider": "zoho_workdrive", "permalink": external},
            })
            missing_id = self.client.post("/api/admin/testimonials", headers=self.headers, json={
                "displayName": "Missing", "text": "Text", "imageMedia": {"provider": "zoho_workdrive", "permalink": "https://workdrive.zohoexternal.in/external/"},
            })
            lookalike = self.client.post("/api/admin/testimonials", headers=self.headers, json={
                "displayName": "Lookalike", "text": "Text", "imageMedia": {"provider": "zoho_workdrive", "permalink": "https://workdrive.zohoexternal.in.example.com/external/shareid"},
            })
            query = self.client.post("/api/admin/testimonials", headers=self.headers, json={
                "displayName": "Query", "text": "Text", "imageMedia": {"provider": "zoho_workdrive", "permalink": f"{external}?token=unexpected"},
            })
        self.assertEqual(accepted.status_code, 201)
        self.assertEqual(accepted.get_json()["item"]["imageMedia"]["permalink"], external)
        for response in (missing_id, lookalike, query):
            self.assertEqual(response.status_code, 400)
            self.assertIn("approved HTTPS", response.get_json()["error"])

    def test_approved_public_image_and_private_workdrive_validation(self):
        with self.admin_context()[0], self.admin_context()[1], self.admin_context()[2]:
            approved = self.client.post("/api/admin/testimonials", headers=self.headers, json={
                "displayName": "Public portrait", "text": "Text",
                "imageUrl": "https://res.cloudinary.com/example/image/upload/portrait.jpg",
            })
            private = self.client.post("/api/admin/testimonials", headers=self.headers, json={
                "displayName": "Private portrait", "text": "Text",
                "imageUrl": "https://workdrive.zoho.in/file/private",
            })
            unsupported = self.client.post("/api/admin/testimonials", headers=self.headers, json={
                "displayName": "Other portrait", "text": "Text", "imageUrl": "https://images.example.com/portrait.jpg",
            })
        self.assertEqual(approved.status_code, 201)
        self.assertEqual(private.status_code, 400)
        self.assertIn("Managed WorkDrive image", private.get_json()["error"])
        self.assertEqual(unsupported.status_code, 400)

    def test_managed_image_proxy_requires_published_owner_and_fails_safely(self):
        published_id = ObjectId()
        draft_id = ObjectId()
        media = {"id": "managed-id", "provider": "zoho_workdrive", "permalink": "https://workdrive.zoho.in/file/file-id"}
        self.database.testimonials.documents.extend([
            {"_id": published_id, "displayName": "Published", "text": "Text", "status": "published", "imageMedia": media},
            {"_id": draft_id, "displayName": "Draft", "text": "Text", "status": "draft", "imageMedia": media},
        ])
        upstream = SimpleNamespace(
            headers={"Content-Type": "image/jpeg"},
            iter_content=lambda chunk_size: iter([b"image-bytes"]),
            close=lambda: None,
        )
        with patch("app.blueprints.content.routes.database", return_value=self.database), patch(
            "app.blueprints.content.routes.download_file", return_value=WorkDriveDownload(upstream, "file-id")
        ):
            served = self.client.get(f"/api/content/testimonials/{published_id}/image", buffered=True)
            hidden = self.client.get(f"/api/content/testimonials/{draft_id}/image")
        self.assertEqual(served.status_code, 200)
        self.assertEqual(served.content_type, "image/jpeg")
        self.assertEqual(hidden.status_code, 404)

        with patch("app.blueprints.content.routes.database", return_value=self.database), patch(
            "app.blueprints.content.routes.download_file", side_effect=WorkDriveUnavailable("Unavailable", "provider_unavailable")
        ):
            unavailable = self.client.get(f"/api/content/testimonials/{published_id}/image")
        self.assertEqual(unavailable.status_code, 503)


if __name__ == "__main__":
    unittest.main()
