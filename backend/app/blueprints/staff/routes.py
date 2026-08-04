from flask import Blueprint, jsonify

from ...rbac import requireStaff

staff_bp = Blueprint("staff", __name__)


@staff_bp.get("/dashboard")
@requireStaff
def dashboard():
    return jsonify({"dashboard": "staff", "permissions": ["products:manage", "inventory:manage", "orders:manage", "customers:read"]}), 200
