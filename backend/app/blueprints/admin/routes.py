from datetime import datetime, timezone

from bson import ObjectId
from flask import Blueprint, jsonify, request

from ...rbac import ROLES, current_user, database, requireAdmin

admin_bp = Blueprint("admin", __name__)


def _user_view(user: dict) -> dict:
    return {
        "id": str(user["_id"]),
        "email": user.get("email"),
        "username": user.get("username"),
        "displayName": user.get("displayName"),
        "role": user.get("role", "customer"),
        "isActive": user.get("isActive", True),
        "emailVerified": user.get("emailVerified", False),
        "createdAt": user.get("createdAt"),
        "updatedAt": user.get("updatedAt"),
    }


@admin_bp.get("/users")
@requireAdmin
def list_users():
    users = database().users.find().sort("createdAt", -1)
    return jsonify({"users": [_user_view(user) for user in users]}), 200


@admin_bp.patch("/users/<user_id>/role")
@requireAdmin
def change_role(user_id: str):
    if not ObjectId.is_valid(user_id):
        return jsonify({"error": "Invalid user id."}), 400
    payload = request.get_json(silent=True) or {}
    new_role = payload.get("role")
    if new_role not in ROLES:
        return jsonify({"error": "Role must be customer, staff, or admin."}), 400

    users = database().users
    target_id = ObjectId(user_id)
    target = users.find_one({"_id": target_id})
    if not target:
        return jsonify({"error": "User not found."}), 404
    previous_role = target.get("role", "customer")
    if previous_role == new_role:
        return jsonify({"user": _user_view(target)}), 200
    if previous_role == "admin" and new_role != "admin" and users.count_documents({"role": "admin", "isActive": {"$ne": False}}) <= 1:
        return jsonify({"error": "The last remaining admin cannot be demoted."}), 409

    now = datetime.now(timezone.utc)
    users.update_one({"_id": target_id}, {"$set": {"role": new_role, "updatedAt": now}})
    actor = current_user()
    database().role_change_logs.insert_one({
        "changedBy": actor["_id"],
        "user": target_id,
        "previousRole": previous_role,
        "newRole": new_role,
        "timestamp": now,
    })
    target = users.find_one({"_id": target_id})
    return jsonify({"user": _user_view(target)}), 200


@admin_bp.patch("/users/<user_id>/status")
@requireAdmin
def change_status(user_id: str):
    if not ObjectId.is_valid(user_id):
        return jsonify({"error": "Invalid user id."}), 400
    active = (request.get_json(silent=True) or {}).get("isActive")
    if not isinstance(active, bool):
        return jsonify({"error": "isActive must be boolean."}), 400
    users = database().users
    target = users.find_one({"_id": ObjectId(user_id)})
    if not target:
        return jsonify({"error": "User not found."}), 404
    if target.get("role", "customer") == "admin" and not active and users.count_documents({"role": "admin", "isActive": {"$ne": False}}) <= 1:
        return jsonify({"error": "The last remaining admin cannot be deactivated."}), 409
    users.update_one({"_id": target["_id"]}, {"$set": {"isActive": active, "updatedAt": datetime.now(timezone.utc)}})
    return jsonify({"user": _user_view(users.find_one({"_id": target["_id"]}))}), 200
