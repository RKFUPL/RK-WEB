from datetime import datetime, timedelta, timezone
import secrets
import re

import resend
from bcrypt import checkpw, gensalt, hashpw
from bson import ObjectId
from flask import Blueprint, current_app, jsonify, request
from flask_jwt_extended import create_access_token, get_jwt_identity, jwt_required, unset_jwt_cookies

from ...extensions import limiter, mongo
from ...rbac import requireAuth

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
        "username": user.get("username"),
        "displayName": user.get("displayName"),
        "phone": user.get("phone"),
        "gender": user.get("gender"),
        "role": user.get("role", "customer"),
        "isActive": user.get("isActive", True),
        "emailVerified": user.get("emailVerified", False),
        "profileImage": user.get("profileImage"),
        "firstName": user.get("firstName", user.get("displayName", "").split(" ")[0]),
        "lastName": user.get("lastName", " ".join(user.get("displayName", "").split(" ")[1:])),
        "dob": user.get("dob"),
        "language": user.get("language", "English"),
        "region": user.get("region", "asia-india"),
        "currency": user.get("currency", _currency_for_region(user.get("region", "asia-india"))),
        "newsletter": user.get("newsletter", False),
        "marketingEmails": user.get("marketingEmails", False),
        "whatsappNotifications": user.get("whatsappNotifications", False),
    }


def _initial_role(email: str, email_verified: bool) -> str:
    """Determine a role only for a brand-new, verified account."""
    return "staff" if email_verified and email.endswith("@rashikapoorofficial.com") else "customer"


def _split_name(value: str) -> tuple[str, str]:
    parts = str(value or "").strip().split()
    return (parts[0] if parts else "", " ".join(parts[1:]))


def _currency_for_region(region: str) -> str:
    return {"asia-india": "INR", "us": "USD", "europe": "EUR", "anywhere-else": "USD"}.get(region, "USD")


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
            "role": "customer",
            "isActive": True,
            "emailVerified": False,
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
    phone = str(payload.get("phone") or "").strip()
    region = str(payload.get("region") or "").strip().lower()
    password = payload.get("password")
    if not email or "@" not in email or not username or not display_name or not phone or not re.fullmatch(r"\+?[0-9\s().-]{7,20}", phone) or region not in {"asia-india", "us", "europe", "anywhere-else"} or not _valid_password(password):
        return jsonify({"error": "Full name, username, valid email, phone number, region, and an 8-character password are required."}), 400

    users = _database().users
    email_exists = users.find_one({"email": email})
    username_exists = users.find_one({"username": username})
    if email_exists or username_exists:
        conflicts = []
        if email_exists:
            conflicts.append("That email is already registered.")
        if username_exists:
            conflicts.append("That username is already taken.")
        return jsonify({"error": " ".join(conflicts)}), 409

    now = datetime.now(timezone.utc)
    otp = f"{secrets.randbelow(1_000_000):06d}"
    _database().otp_challenges.replace_one(
        {"email": email, "purpose": "signup"},
        {
            "email": email,
            "purpose": "signup",
            "username": username,
            "displayName": display_name,
            "phone": phone,
            "region": region,
            "currency": _currency_for_region(region),
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

    first_name, last_name = _split_name(challenge["displayName"])
    user_id = _database().users.insert_one({
        "email": challenge["email"],
        "username": challenge["username"],
        "displayName": challenge["displayName"],
        "firstName": first_name,
        "lastName": last_name,
        "phone": challenge.get("phone"),
        "region": challenge.get("region", "asia-india"),
        "currency": challenge.get("currency", _currency_for_region(challenge.get("region", "asia-india"))),
        "passwordHash": challenge["passwordHash"],
        "role": _initial_role(challenge["email"], True),
        "isActive": True,
        "emailVerified": True,
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
    if user.get("isActive", True) is False:
        return jsonify({"error": "This account is inactive. Please contact an administrator."}), 403
    # Backfill legacy documents without changing an existing role.
    _database().users.update_one({"_id": user["_id"]}, {"$setOnInsert": {"role": "customer", "isActive": True, "emailVerified": False}})
    user = _database().users.find_one({"_id": user["_id"]})
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
        {"$unset": {"otpHash": "", "otpExpiresAt": "", "otpAttempts": ""}, "$set": {"lastLoginAt": now, "emailVerified": True, "updatedAt": now}},
    )
    user = _database().users.find_one({"_id": user["_id"]})
    token = create_access_token(identity=str(user["_id"]))
    return jsonify({"accessToken": token, "user": _public_user(user)}), 200


@auth_bp.get("/me")
@requireAuth
def me():
    user = _database().users.find_one({"_id": ObjectId(get_jwt_identity())})
    if not user:
        return jsonify({"error": "Profile not found."}), 404
    return jsonify({"user": _public_user(user)}), 200


@auth_bp.put("/profile")
@requireAuth
def update_profile():
    payload = request.get_json(silent=True) or {}
    user_id = ObjectId(get_jwt_identity())
    users = _database().users
    current = users.find_one({"_id": user_id})
    if not current:
        return jsonify({"error": "Profile not found."}), 404
    if "email" in payload and _normalise_email(payload.get("email")) != current.get("email"):
        return jsonify({"error": "Email changes require verification."}), 400

    updates = {}
    for key in ("firstName", "lastName", "username", "phone", "language"):
        if payload.get(key) is not None:
            value = str(payload[key]).strip()
            if key in {"firstName", "lastName"} and len(value) > 80:
                return jsonify({"error": f"{key} is too long."}), 400
            updates[key] = value
    if "username" in updates:
        if not re.fullmatch(r"[a-zA-Z0-9_.-]{3,30}", updates["username"]):
            return jsonify({"error": "Username must be 3–30 characters and use letters, numbers, dots, dashes, or underscores."}), 400
        duplicate = users.find_one({"username": updates["username"].lower(), "_id": {"$ne": user_id}})
        if duplicate:
            return jsonify({"error": "That username is already in use."}), 409
        updates["username"] = updates["username"].lower()
    if "phone" in updates and updates["phone"] and not re.fullmatch(r"\+?[0-9\s().-]{7,20}", updates["phone"]):
        return jsonify({"error": "Enter a valid phone number."}), 400
    if "region" in payload:
        region = str(payload.get("region") or "").strip().lower()
        if region not in {"asia-india", "us", "europe", "anywhere-else"}:
            return jsonify({"error": "Please choose a valid region."}), 400
        updates["region"] = region
        updates["currency"] = _currency_for_region(region)
    if "dob" in payload and payload.get("dob"):
        try:
            dob = datetime.strptime(str(payload["dob"]), "%Y-%m-%d").date()
        except ValueError:
            return jsonify({"error": "Enter a valid date of birth."}), 400
        if dob >= datetime.now(timezone.utc).date() or dob.year < datetime.now(timezone.utc).year - 120:
            return jsonify({"error": "Enter a valid date of birth."}), 400
        updates["dob"] = dob.isoformat()
    elif "dob" in payload:
        updates["dob"] = None
    if "gender" in payload:
        gender = str(payload["gender"] or "").strip().lower()
        if gender not in {"male", "female", "prefer-not-to-say", ""}:
            return jsonify({"error": "Please choose a valid gender option."}), 400
        updates["gender"] = gender
    if "profileImage" in payload:
        image = payload.get("profileImage")
        if image and (not isinstance(image, str) or len(image) > 4_000_000 or not re.match(r"^(https://|data:image/(png|jpeg|jpg|webp);base64,)", image)):
            return jsonify({"error": "Upload a valid JPG, PNG, or WebP image under 3 MB."}), 400
        updates["profileImage"] = image or None
    for key in ("newsletter", "marketingEmails", "whatsappNotifications"):
        if key in payload:
            if not isinstance(payload[key], bool):
                return jsonify({"error": f"{key} must be boolean."}), 400
            updates[key] = payload[key]
    if payload.get("language") is not None and updates.get("language") not in {"English", "Hindi"}:
        return jsonify({"error": "Please choose a supported language."}), 400
    if not updates:
        return jsonify({"error": "No profile changes were submitted."}), 400

    now = datetime.now(timezone.utc)
    updates["updatedAt"] = now
    users.update_one({"_id": user_id}, {"$set": updates})
    _database().profile_update_logs.insert_one({"user": user_id, "changedFields": sorted(updates.keys()), "timestamp": now})
    user = _database().users.find_one({"_id": user_id})
    return jsonify({"user": _public_user(user)}), 200


def _address_view(address: dict) -> dict:
    fields = ("label", "fullName", "phone", "line1", "line2", "city", "state", "postalCode", "country", "isDefault")
    return {"id": str(address["_id"]), **{key: address.get(key, "") for key in fields}}


@auth_bp.get("/addresses")
@requireAuth
def list_addresses():
    user_id = ObjectId(get_jwt_identity())
    addresses = _database().addresses.find({"userId": user_id}).sort("isDefault", -1)
    return jsonify({"addresses": [_address_view(address) for address in addresses]}), 200


@auth_bp.post("/addresses")
@requireAuth
def create_address():
    payload = request.get_json(silent=True) or {}
    required = ("fullName", "phone", "line1", "city", "state", "postalCode", "country")
    if any(not str(payload.get(key) or "").strip() for key in required):
        return jsonify({"error": "Complete all required address fields."}), 400
    phone = str(payload["phone"]).strip()
    if not re.fullmatch(r"\+?[0-9\s().-]{7,20}", phone):
        return jsonify({"error": "Enter a valid address phone number."}), 400
    user_id = ObjectId(get_jwt_identity())
    addresses = _database().addresses
    is_default = bool(payload.get("isDefault")) or addresses.count_documents({"userId": user_id}) == 0
    now = datetime.now(timezone.utc)
    if is_default:
        addresses.update_many({"userId": user_id}, {"$set": {"isDefault": False}})
    fields = ("label", "fullName", "phone", "line1", "line2", "city", "state", "postalCode", "country")
    document = {key: str(payload.get(key) or "").strip() for key in fields}
    document.update({"userId": user_id, "isDefault": is_default, "createdAt": now, "updatedAt": now})
    address_id = addresses.insert_one(document).inserted_id
    return jsonify({"address": _address_view(addresses.find_one({"_id": address_id}))}), 201


@auth_bp.delete("/addresses/<address_id>")
@requireAuth
def delete_address(address_id: str):
    if not ObjectId.is_valid(address_id):
        return jsonify({"error": "Invalid address id."}), 400
    result = _database().addresses.delete_one({"_id": ObjectId(address_id), "userId": ObjectId(get_jwt_identity())})
    if not result.deleted_count:
        return jsonify({"error": "Address not found."}), 404
    return jsonify({"message": "Address removed."}), 200


@auth_bp.post("/profile/email/request")
@requireAuth
def request_email_change():
    payload = request.get_json(silent=True) or {}
    email = _normalise_email(payload.get("email"))
    if not email or not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
        return jsonify({"error": "Enter a valid email address."}), 400
    user_id = ObjectId(get_jwt_identity())
    users = _database().users
    if users.find_one({"email": email, "_id": {"$ne": user_id}}):
        return jsonify({"error": "That email is already in use."}), 409
    otp = f"{secrets.randbelow(1_000_000):06d}"
    now = datetime.now(timezone.utc)
    _database().email_change_challenges.replace_one(
        {"userId": user_id},
        {"userId": user_id, "email": email, "otpHash": hashpw(otp.encode(), gensalt()).decode(), "otpExpiresAt": now + timedelta(minutes=10), "createdAt": now},
        upsert=True,
    )
    try:
        _send_otp_email(email, otp)
    except Exception:
        current_app.logger.exception("Unable to send email-change OTP")
        return jsonify({"error": "We could not send the verification code. Please try again."}), 502
    return jsonify({"message": "A verification code has been sent to your new email."}), 202


@auth_bp.post("/profile/email/verify")
@requireAuth
def verify_email_change():
    payload = request.get_json(silent=True) or {}
    user_id = ObjectId(get_jwt_identity())
    challenge = _database().email_change_challenges.find_one({"userId": user_id})
    otp = str(payload.get("otp") or "").strip()
    now = datetime.now(timezone.utc)
    if not challenge or len(otp) != 6 or _is_expired(challenge.get("otpExpiresAt"), now) or not checkpw(otp.encode(), challenge["otpHash"].encode()):
        return jsonify({"error": "The verification code is invalid or expired."}), 400
    _database().users.update_one({"_id": user_id}, {"$set": {"email": challenge["email"], "emailVerified": True, "updatedAt": now}})
    _database().profile_update_logs.insert_one({"user": user_id, "changedFields": ["email", "emailVerified"], "timestamp": now})
    _database().email_change_challenges.delete_one({"_id": challenge["_id"]})
    return jsonify({"user": _public_user(_database().users.find_one({"_id": user_id}))}), 200


@auth_bp.delete("/profile")
@requireAuth
def delete_profile():
    user_id = ObjectId(get_jwt_identity())
    now = datetime.now(timezone.utc)
    _database().users.update_one({"_id": user_id}, {"$set": {"isActive": False, "updatedAt": now, "deletedAt": now}})
    _database().profile_update_logs.insert_one({"user": user_id, "changedFields": ["isActive"], "timestamp": now, "action": "delete"})
    return jsonify({"message": "Your account has been deleted."}), 200


@auth_bp.post("/logout")
def logout():
    response = jsonify({"message": "Logged out."})
    unset_jwt_cookies(response)
    return response, 200
