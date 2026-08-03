from datetime import datetime, timedelta, timezone
import secrets

import resend
from bcrypt import checkpw, gensalt, hashpw
from bson import ObjectId
from flask import Blueprint, current_app, jsonify, request
from flask_jwt_extended import create_access_token, get_jwt_identity, jwt_required, unset_jwt_cookies

from ...extensions import limiter, mongo

auth_bp = Blueprint("auth", __name__)


def _database():
    """Use the URI database when present, otherwise apply DB_NAME explicitly."""
    return mongo.db or mongo.cx[current_app.config["MONGO_DBNAME"]]


def _normalise_email(value: object) -> str:
    return str(value or "").strip().lower()


def _normalise_username(value: object) -> str:
    return str(value or "").strip().lower()


def _password_hash(password: str) -> str:
    return hashpw(password.encode(), gensalt()).decode()


def _valid_password(password: object) -> bool:
    return isinstance(password, str) and len(password) >= 8


def _send_otp_email(email: str, otp: str) -> None:
    api_key = current_app.config["RESEND_API_KEY"]
    if not api_key:
        raise RuntimeError("RESEND_API_KEY is not configured")

    resend.api_key = api_key
    resend.Emails.send(
        {
            "from": f'{current_app.config["EMAIL_FROM_NAME"]} <{current_app.config["EMAIL_FROM"]}>',
            "to": [email],
            "subject": "Your Rashi Kapoor login code",
            "html": f"<p>Your one-time login code is <strong>{otp}</strong>.</p><p>This code expires in 10 minutes.</p>",
        }
    )


def _public_user(user: dict) -> dict:
    return {
        "id": str(user["_id"]),
        "email": user["email"],
        "displayName": user.get("displayName"),
        "phone": user.get("phone"),
        "gender": user.get("gender"),
    }


def _is_expired(value: object, now: datetime) -> bool:
    if not isinstance(value, datetime):
        return True
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value < now


@auth_bp.post("/request-otp")
@limiter.limit("5 per 15 minutes")
def request_otp():
    email = _normalise_email((request.get_json(silent=True) or {}).get("email"))
    if not email or "@" not in email:
        return jsonify({"error": "A valid email address is required."}), 400

    now = datetime.now(timezone.utc)
    users = _database().users
    user = users.find_one({"email": email})
    if not user:
        user_id = users.insert_one({
            "email": email,
            "createdAt": now,
            "updatedAt": now,
            "profile": {},
        }).inserted_id
        user = users.find_one({"_id": user_id})

    otp = f"{secrets.randbelow(1_000_000):06d}"
    users.update_one(
        {"_id": user["_id"]},
        {"$set": {
            "otpHash": hashpw(otp.encode(), gensalt()).decode(),
            "otpExpiresAt": now + timedelta(minutes=10),
            "otpAttempts": 0,
            "updatedAt": now,
        }},
    )

    try:
        _send_otp_email(email, otp)
    except Exception:
        current_app.logger.exception("Unable to send OTP")
        return jsonify({"error": "We could not send the login code. Please try again."}), 502

    return jsonify({"message": "If the email is valid, a login code has been sent."}), 202


@auth_bp.post("/signup/request-otp")
@limiter.limit("5 per 15 minutes")
def signup_request_otp():
    payload = request.get_json(silent=True) or {}
    email = _normalise_email(payload.get("email"))
    username = _normalise_username(payload.get("username"))
    display_name = str(payload.get("displayName") or "").strip()
    password = payload.get("password")
    if not email or "@" not in email or not username or not display_name or not _valid_password(password):
        return jsonify({"error": "Full name, username, valid email, and an 8-character password are required."}), 400

    users = _database().users
    if users.find_one({"$or": [{"email": email}, {"username": username}]}):
        return jsonify({"error": "That email or username is already registered."}), 409

    now = datetime.now(timezone.utc)
    otp = f"{secrets.randbelow(1_000_000):06d}"
    _database().otp_challenges.replace_one(
        {"email": email, "purpose": "signup"},
        {
            "email": email,
            "purpose": "signup",
            "username": username,
            "displayName": display_name,
            "passwordHash": _password_hash(password),
            "otpHash": hashpw(otp.encode(), gensalt()).decode(),
            "otpExpiresAt": now + timedelta(minutes=10),
            "otpAttempts": 0,
            "createdAt": now,
        },
        upsert=True,
    )
    try:
        _send_otp_email(email, otp)
    except Exception:
        current_app.logger.exception("Unable to send signup OTP")
        return jsonify({"error": "We could not send the signup code. Please try again."}), 502
    return jsonify({"message": "A signup code has been sent."}), 202


@auth_bp.post("/signup/verify-otp")
@limiter.limit("10 per 15 minutes")
def signup_verify_otp():
    payload = request.get_json(silent=True) or {}
    email = _normalise_email(payload.get("email"))
    otp = str(payload.get("otp") or "").strip()
    challenge = _database().otp_challenges.find_one({"email": email, "purpose": "signup"})
    now = datetime.now(timezone.utc)
    if not challenge or len(otp) != 6 or _is_expired(challenge.get("otpExpiresAt"), now):
        return jsonify({"error": "The signup code is invalid or expired."}), 400
    if challenge.get("otpAttempts", 0) >= 5:
        return jsonify({"error": "Too many attempts. Please request a new code."}), 400
    _database().otp_challenges.update_one({"_id": challenge["_id"]}, {"$inc": {"otpAttempts": 1}})
    if not checkpw(otp.encode(), challenge["otpHash"].encode()):
        return jsonify({"error": "The signup code is invalid or expired."}), 400

    user_id = _database().users.insert_one({
        "email": challenge["email"],
        "username": challenge["username"],
        "displayName": challenge["displayName"],
        "passwordHash": challenge["passwordHash"],
        "createdAt": now,
        "updatedAt": now,
        "profile": {},
    }).inserted_id
    _database().otp_challenges.delete_one({"_id": challenge["_id"]})
    user = _database().users.find_one({"_id": user_id})
    return jsonify({"accessToken": create_access_token(identity=str(user_id)), "user": _public_user(user)}), 201


@auth_bp.post("/login")
@limiter.limit("10 per 15 minutes")
def login():
    payload = request.get_json(silent=True) or {}
    identifier = str(payload.get("identifier") or "").strip().lower()
    password = payload.get("password")
    user = _database().users.find_one({"$or": [{"email": identifier}, {"username": identifier}]})
    if not user:
        return jsonify({"error": "User not found. Please sign in with an existing account."}), 404
    if not user.get("passwordHash") or not isinstance(password, str) or not checkpw(password.encode(), user["passwordHash"].encode()):
        return jsonify({"error": "Email/username or password is incorrect."}), 401
    return jsonify({"accessToken": create_access_token(identity=str(user["_id"])), "user": _public_user(user)}), 200


@auth_bp.post("/forgot-password/request-otp")
@limiter.limit("5 per 15 minutes")
def forgot_password_request_otp():
    identifier = str((request.get_json(silent=True) or {}).get("identifier") or "").strip().lower()
    user = _database().users.find_one({"$or": [{"email": identifier}, {"username": identifier}]})
    if not user:
        return jsonify({"message": "If the account exists, a recovery code has been sent."}), 202
    now = datetime.now(timezone.utc)
    otp = f"{secrets.randbelow(1_000_000):06d}"
    _database().otp_challenges.replace_one(
        {"userId": user["_id"], "purpose": "forgot-password"},
        {"userId": user["_id"], "purpose": "forgot-password", "email": user["email"], "otpHash": hashpw(otp.encode(), gensalt()).decode(), "otpExpiresAt": now + timedelta(minutes=10), "otpAttempts": 0},
        upsert=True,
    )
    try:
        _send_otp_email(user["email"], otp)
    except Exception:
        current_app.logger.exception("Unable to send recovery OTP")
        return jsonify({"error": "We could not send the recovery code. Please try again."}), 502
    return jsonify({"message": "If the account exists, a recovery code has been sent."}), 202


@auth_bp.post("/forgot-password/reset")
@limiter.limit("10 per 15 minutes")
def forgot_password_reset():
    payload = request.get_json(silent=True) or {}
    identifier = str(payload.get("identifier") or "").strip().lower()
    otp = str(payload.get("otp") or "").strip()
    password = payload.get("password")
    user = _database().users.find_one({"$or": [{"email": identifier}, {"username": identifier}]})
    challenge = _database().otp_challenges.find_one({"userId": user["_id"], "purpose": "forgot-password"}) if user else None
    now = datetime.now(timezone.utc)
    if not user or not challenge or not _valid_password(password) or len(otp) != 6 or _is_expired(challenge.get("otpExpiresAt"), now):
        return jsonify({"error": "The recovery code is invalid or expired."}), 400
    if not checkpw(otp.encode(), challenge["otpHash"].encode()):
        return jsonify({"error": "The recovery code is invalid or expired."}), 400
    _database().users.update_one({"_id": user["_id"]}, {"$set": {"passwordHash": _password_hash(password), "updatedAt": now}})
    _database().otp_challenges.delete_one({"_id": challenge["_id"]})
    return jsonify({"message": "Password updated. You can now sign in."}), 200


@auth_bp.post("/verify-otp")
@limiter.limit("10 per 15 minutes")
def verify_otp():
    payload = request.get_json(silent=True) or {}
    email = _normalise_email(payload.get("email"))
    otp = str(payload.get("otp") or "").strip()
    user = _database().users.find_one({"email": email})
    now = datetime.now(timezone.utc)

    if not user or not user.get("otpHash") or len(otp) != 6:
        return jsonify({"error": "The code is invalid or expired."}), 400
    if _is_expired(user.get("otpExpiresAt"), now) or user.get("otpAttempts", 0) >= 5:
        return jsonify({"error": "The code is invalid or expired."}), 400

    _database().users.update_one({"_id": user["_id"]}, {"$inc": {"otpAttempts": 1}})
    if not checkpw(otp.encode(), user["otpHash"].encode()):
        return jsonify({"error": "The code is invalid or expired."}), 400

    _database().users.update_one(
        {"_id": user["_id"]},
        {"$unset": {"otpHash": "", "otpExpiresAt": "", "otpAttempts": ""}, "$set": {"lastLoginAt": now}},
    )
    token = create_access_token(identity=str(user["_id"]))
    return jsonify({"accessToken": token, "user": _public_user(user)}), 200


@auth_bp.get("/me")
@jwt_required()
def me():
    user = _database().users.find_one({"_id": ObjectId(get_jwt_identity())})
    if not user:
        return jsonify({"error": "Profile not found."}), 404
    return jsonify({"user": _public_user(user)}), 200


@auth_bp.put("/profile")
@jwt_required()
def update_profile():
    payload = request.get_json(silent=True) or {}
    updates = {
        key: str(payload[key]).strip()
        for key in ("displayName", "phone", "gender")
        if payload.get(key) is not None
    }
    if not updates:
        return jsonify({"error": "At least one profile field is required."}), 400
    if "gender" in updates and updates["gender"] not in {"female", "male", "non-binary", "prefer-not-to-say"}:
        return jsonify({"error": "Please choose a valid gender option."}), 400

    user_id = ObjectId(get_jwt_identity())
    _database().users.update_one({"_id": user_id}, {"$set": {**updates, "updatedAt": datetime.now(timezone.utc)}})
    user = _database().users.find_one({"_id": user_id})
    return jsonify({"user": _public_user(user)}), 200


@auth_bp.post("/logout")
def logout():
    response = jsonify({"message": "Logged out."})
    unset_jwt_cookies(response)
    return response, 200
