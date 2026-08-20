import unittest
from types import SimpleNamespace
from unittest.mock import patch

from flask import Flask
from flask_jwt_extended import JWTManager, create_access_token

from app.blueprints.admin.routes import admin_bp
from bson import ObjectId
from app.blueprints.staff.routes import _customer_scope, staff_bp


class TrackingUsers:
    def __init__(self, documents):
        self.documents = documents
        self.query = None

    def find(self, query):
        self.query = query
        return self

    def sort(self, *_args):
        return self.documents


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

    def test_customer_cannot_call_staff_endpoint(self):
        customer = {"_id": "customer", "role": "customer", "isActive": True}
        with patch("app.rbac.current_user", return_value=customer):
            response = self.client.get("/api/staff/resources/products", headers=self.headers)
        self.assertEqual(response.status_code, 403)

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

    def test_customer_cannot_call_admin_endpoint(self):
        customer = {"_id": "customer", "role": "customer", "isActive": True}
        with patch("app.rbac.current_user", return_value=customer):
            response = self.client.get("/api/admin/users", headers=self.headers)
        self.assertEqual(response.status_code, 403)

    def test_admin_users_endpoint_only_queries_staff_and_admin(self):
        admin = {"_id": ObjectId(), "displayName": "Admin", "role": "admin", "isActive": True}
        staff = {"_id": ObjectId(), "displayName": "Staff", "role": "staff", "isActive": True}
        users = TrackingUsers([admin, staff])
        with patch("app.rbac.current_user", return_value=admin), patch("app.blueprints.admin.routes.database", return_value=SimpleNamespace(users=users)):
            response = self.client.get("/api/admin/users", headers=self.headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(users.query, {"role": {"$in": ["staff", "admin"]}})
        self.assertEqual([user["role"] for user in response.get_json()["users"]], ["admin", "staff"])

    def test_staff_customer_scope_is_assignment_limited(self):
        staff_id = ObjectId()
        self.assertEqual(_customer_scope({"_id": staff_id, "role": "staff"}), {"role": "customer", "assignedStaffId": staff_id})

    def test_admin_customer_scope_is_not_assignment_limited(self):
        self.assertEqual(_customer_scope({"_id": ObjectId(), "role": "admin"}), {"role": "customer"})


if __name__ == "__main__":
    unittest.main()
