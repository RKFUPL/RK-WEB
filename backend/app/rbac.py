"""Server-side role and permission guards.

Roles are intentionally represented as strings so adding a future role does not
require changing authentication tokens or database documents.
"""
from functools import wraps
from typing import Callable

from bson import ObjectId
from flask import current_app, jsonify
from flask_jwt_extended import get_jwt_identity, jwt_required

from .extensions import mongo

ROLES = ("customer", "staff", "admin")
ROLE_RANK = {"customer": 1, "staff": 2, "admin": 3}


def database():
    return mongo.db or mongo.cx[current_app.config["MONGO_DBNAME"]]


def current_user():
    try:
        user_id = ObjectId(get_jwt_identity())
    except Exception:
        return None
    users = database().users
    user = users.find_one({"_id": user_id})
    if not user:
        return None
    # Migrate older documents lazily. Missing fields are added, but an
    # existing role is never changed by authentication or authorization code.
    defaults = {
        "role": "customer",
        "isActive": True,
        "emailVerified": False,
        "updatedAt": user.get("updatedAt"),
    }
    missing = {key: value for key, value in defaults.items() if key not in user and value is not None}
    if missing:
        users.update_one({"_id": user_id}, {"$set": missing})
        user.update(missing)
    return user


def _guard(allowed_roles: set[str]) -> Callable:
    def decorator(view: Callable) -> Callable:
        @wraps(view)
        @jwt_required()
        def wrapped(*args, **kwargs):
            user = current_user()
            if not user or user.get("isActive", True) is False:
                return jsonify({"error": "Authentication required."}), 401
            role = user.get("role", "customer")
            if role not in allowed_roles:
                return jsonify({"error": "You do not have permission to perform this action."}), 403
            return view(*args, **kwargs)

        return wrapped
    return decorator


def requireAuth(view: Callable) -> Callable:
    return _guard(set(ROLES))(view)


def requireCustomer(view: Callable) -> Callable:
    return _guard({"customer"})(view)


def requireStaff(view: Callable) -> Callable:
    return _guard({"staff", "admin"})(view)


def requireAdmin(view: Callable) -> Callable:
    return _guard({"admin"})(view)


# snake_case aliases are convenient for Python callers while the camelCase
# names mirror the API contract.
require_auth = requireAuth
require_customer = requireCustomer
require_staff = requireStaff
require_admin = requireAdmin
