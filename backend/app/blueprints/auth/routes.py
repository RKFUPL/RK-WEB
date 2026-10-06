from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import secrets
import re

from bcrypt import checkpw, gensalt, hashpw
from bson import ObjectId
from flask import Blueprint, current_app, jsonify, request
from flask_jwt_extended import create_access_token, get_jwt, unset_jwt_cookies

from ...extensions import limiter, mongo
from ...mail import send_otp
from ...rbac import authenticated_user_id, effective_permissions, requireAuth
from ...credential_sync import next_credential_version, sync_event

auth_bp = Blueprint("auth", __name__)


def _database():
    """Use the URI database when present, otherwise apply DB_NAME explicitly."""
    return mongo.db or mongo.cx[current_app.config["MONGO_DBNAME"]]


def _shared_session_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _shared_cookie(response, token: str, expires: datetime | None = None):
    response.set_cookie(
        current_app.config.get("SHARED_SESSION_COOKIE_NAME", "rk_shared_session"), token,
        max_age=current_app.config.get("AUTH_SESSION_DAYS", 30) * 86400,
        expires=expires,
        domain=current_app.config.get("SHARED_SESSION_COOKIE_DOMAIN") or None,
        path="/", secure=current_app.config.get("SHARED_SESSION_COOKIE_SECURE", True),
        httponly=True, samesite=current_app.config.get("SHARED_SESSION_COOKIE_SAMESITE", "Lax"),
    )
    return response


def _create_shared_session(user_id: ObjectId) -> tuple[str, datetime]:
    token = secrets.token_urlsafe(48)
    expires = datetime.now(timezone.utc) + timedelta(days=current_app.config.get("AUTH_SESSION_DAYS", 30))
    _database().auth_sessions.insert_one({
        "tokenHash": _shared_session_hash(token), "userId": user_id,
        "expiresAt": expires, "createdAt": datetime.now(timezone.utc),
        "lastSeenAt": datetime.now(timezone.utc), "revokedAt": None,
    })
    return token, expires


def _shared_session_user(token: str):
    if not token:
        return None
    session = _database().auth_sessions.find_one({"tokenHash": _shared_session_hash(token), "revokedAt": None})
    now = datetime.now(timezone.utc)
    expires_at = session.get("expiresAt") if session else None
    if expires_at and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if not session or not expires_at or expires_at <= now:
        return None
    user = _database().users.find_one({"_id": session["userId"], "isActive": {"$ne": False}})
    if not user:
        return None
    new_expiry = now + timedelta(days=current_app.config.get("AUTH_SESSION_DAYS", 30))
    _database().auth_sessions.update_one({"_id": session["_id"]}, {"$set": {"lastSeenAt": now, "expiresAt": new_expiry}})
    return user


def _normalise_email(value: object) -> str:
    return str(value or "").strip().lower()


def _normalise_username(value: object) -> str:
    return str(value or "").strip()


def _identifier_query(identifier: str) -> dict:
    """Match email case-insensitively and usernames exactly as entered."""
    return {"$or": [{"email": _normalise_email(identifier)}, {"username": identifier}]}


def _password_hash(password: str) -> str:
    return hashpw(password.encode(), gensalt()).decode()


def _valid_password(password: object) -> bool:
    return isinstance(password, str) and len(password) >= 8


def _send_otp_email(email: str, otp: str, purpose: str = "verification") -> None:
    send_otp(email, otp, purpose)


def _public_user(user: dict) -> dict:
    first_name = user.get("firstName") or str(user.get("displayName") or "").split(" ")[0]
    last_name = user.get("lastName") or " ".join(str(user.get("displayName") or "").split(" ")[1:])
    canonical_name = " ".join(filter(None, (first_name, last_name))) or user.get("displayName")
    return {
        "id": str(user["_id"]),
        "email": user["email"],
        "username": user.get("username"),
        "displayName": canonical_name,
        "phone": user.get("phone"),
        "gender": user.get("gender"),
        "role": user.get("role", "customer"),
        "permissions": effective_permissions(user),
        "isActive": user.get("isActive", True),
        "emailVerified": user.get("emailVerified", False),
        "profileImage": user.get("profileImage"),
        "firstName": first_name,
        "lastName": last_name,
        "dob": user.get("dob"),
        "language": user.get("language", "English"),
        "region": user.get("region", "asia-india"),
        "currency": user.get("currency", _currency_for_region(user.get("region", "asia-india"))),
        "newsletter": user.get("newsletter", False),
        "marketingEmails": user.get("marketingEmails", False),
        "whatsappNotifications": user.get("whatsappNotifications", False),
        "must_change_password": bool(user.get("mustChangePassword", False)),
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


def _valid_dob(value: object) -> str | None:
    try:
        dob = datetime.strptime(str(value or ""), "%Y-%m-%d").date()
    except ValueError:
        return None
    today = datetime.now(timezone.utc).date()
    if dob >= today or dob.year < today.year - 120:
        return None
    return dob.isoformat()


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
    first_name = str(payload.get("firstName") or "").strip()
    last_name = str(payload.get("lastName") or "").strip()
    display_name = " ".join(filter(None, (first_name, last_name))) or str(payload.get("displayName") or "").strip()
    if not first_name and display_name:
        first_name, last_name = _split_name(display_name)
    phone = str(payload.get("phone") or "").strip()
    region = str(payload.get("region") or "").strip().lower()
    dob = _valid_dob(payload.get("dob"))
    gender = str(payload.get("gender") or "").strip().lower()
    password = payload.get("password")
    if not email or "@" not in email or not username or not first_name or not last_name or not phone or not re.fullmatch(r"\+?[0-9\s().-]{7,20}", phone) or not dob or gender not in {"male", "female", "prefer-not-to-say"} or region not in {"asia-india", "us", "europe", "anywhere-else"} or not _valid_password(password):
        return jsonify({"error": "First name, last name, username, valid email, phone number, date of birth, gender, region, and an 8-character password are required."}), 400
    if not re.fullmatch(r"[a-zA-Z0-9_.-]{3,30}", username):
        return jsonify({"error": "Username must be 3-30 characters and use letters, numbers, dots, dashes, or underscores."}), 400

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
            "firstName": first_name,
            "lastName": last_name,
            "phone": phone,
            "dob": dob,
            "gender": gender,
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

    first_name = challenge.get("firstName") or _split_name(challenge["displayName"])[0]
    last_name = challenge.get("lastName") or _split_name(challenge["displayName"])[1]
    user_id = _database().users.insert_one({
        "email": challenge["email"],
        "username": challenge["username"],
        "displayName": challenge["displayName"],
        "firstName": first_name,
        "lastName": last_name,
        "phone": challenge.get("phone"),
        "dob": challenge.get("dob"),
        "gender": challenge.get("gender"),
        "region": challenge.get("region", "asia-india"),
        "currency": challenge.get("currency", _currency_for_region(challenge.get("region", "asia-india"))),
        "passwordHash": challenge["passwordHash"],
        "role": _initial_role(challenge["email"], True),
        "isActive": True,
        "emailVerified": True,
        "createdAt": now,
        "updatedAt": now,
        "profile": {},
        "credentialVersion": 1,
    }).inserted_id
    _database().otp_challenges.delete_one({"_id": challenge["_id"]})
    user = _database().users.find_one({"_id": user_id})
    sync_event(_database(), "USER_CREATED", user)
    session_token, expires = _create_shared_session(user_id)
    response = jsonify({"accessToken": create_access_token(identity=str(user_id)), "user": _public_user(user)})
    return _shared_cookie(response, session_token, expires), 201


@auth_bp.post("/login")
@limiter.limit("10 per 15 minutes")
def login():
    payload = request.get_json(silent=True) or {}
    identifier = str(payload.get("identifier") or "").strip()
    password = payload.get("password")
    user = _database().users.find_one(_identifier_query(identifier))
    if not user:
        return jsonify({"error": "User not found. Please sign in with an existing account."}), 404
    if not user.get("passwordHash") or not isinstance(password, str) or not checkpw(password.encode(), user["passwordHash"].encode()):
        return jsonify({"error": "Email/username or password is incorrect."}), 401
    if user.get("isActive", True) is False:
        return jsonify({"error": "This account is inactive. Please contact an administrator."}), 403
    # Backfill legacy documents without changing an existing role.
    _database().users.update_one({"_id": user["_id"]}, {"$setOnInsert": {"role": "customer", "isActive": True, "emailVerified": False}})
    user = _database().users.find_one({"_id": user["_id"]})
    _database().users.update_one({"_id": user["_id"]}, {"$set": {"lastLoginAt": datetime.now(timezone.utc)}})
    user = _database().users.find_one({"_id": user["_id"]})
    # RK-WEB remains authoritative for login.  This is a best-effort, one-time
    # credential handoff; failures must never affect local authentication.
    if user.get("role") in {"admin", "staff"}:
        sync_event(_database(), "PASSWORD_CHANGED", user, password=password, version=user.get("credentialVersion", 0))
    session_token, expires = _create_shared_session(user["_id"])
    response = jsonify({"accessToken": create_access_token(identity=str(user["_id"])), "user": _public_user(user)})
    return _shared_cookie(response, session_token, expires), 200


@auth_bp.post("/forgot-password/request-otp")
@limiter.limit("5 per 15 minutes")
def forgot_password_request_otp():
    identifier = str((request.get_json(silent=True) or {}).get("identifier") or "").strip()
    user = _database().users.find_one(_identifier_query(identifier))
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
    identifier = str(payload.get("identifier") or "").strip()
    otp = str(payload.get("otp") or "").strip()
    password = payload.get("password")
    user = _database().users.find_one(_identifier_query(identifier))
    challenge = _database().otp_challenges.find_one({"userId": user["_id"], "purpose": "forgot-password"}) if user else None
    now = datetime.now(timezone.utc)
    if not user or not challenge or not _valid_password(password) or len(otp) != 6 or _is_expired(challenge.get("otpExpiresAt"), now) or challenge.get("otpAttempts", 0) >= 5:
        return jsonify({"error": "The recovery code is invalid or expired."}), 400
    _database().otp_challenges.update_one({"_id": challenge["_id"]}, {"$inc": {"otpAttempts": 1}})
    if not checkpw(otp.encode(), challenge["otpHash"].encode()):
        return jsonify({"error": "The recovery code is invalid or expired."}), 400
    version = next_credential_version(user)
    _database().users.update_one({"_id": user["_id"]}, {"$set": {"passwordHash": _password_hash(password), "credentialVersion": version, "updatedAt": now}})
    user["credentialVersion"] = version
    sync_event(_database(), "PASSWORD_RESET", user, password=password, version=version)
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
    session_token, expires = _create_shared_session(user_id)
    response = jsonify({"accessToken": token, "user": _public_user(user)})
    return _shared_cookie(response, session_token, expires), 200


@auth_bp.get("/me")
@requireAuth
def me():
    user = _database().users.find_one({"_id": authenticated_user_id()})
    if not user:
        return jsonify({"error": "Profile not found."}), 404
    return jsonify({"user": _public_user(user)}), 200


@auth_bp.post("/password/change")
@requireAuth
def change_authenticated_password():
    user_id = authenticated_user_id()
    payload = request.get_json(silent=True) or {}
    current_password = payload.get("currentPassword")
    password = payload.get("password")
    confirmation = payload.get("confirmPassword")
    user = _database().users.find_one({"_id": user_id, "isActive": {"$ne": False}})
    if not user or not isinstance(current_password, str) or not user.get("passwordHash") or not checkpw(current_password.encode(), user["passwordHash"].encode()):
        return jsonify({"error": "The current password is incorrect."}), 400
    if password != confirmation or not _valid_password(password) or password == current_password:
        return jsonify({"error": "Choose a new password of at least 8 characters."}), 400
    now = datetime.now(timezone.utc)
    version = next_credential_version(user)
    _database().users.update_one({"_id": user_id}, {"$set": {"passwordHash": _password_hash(password), "mustChangePassword": False, "credentialVersion": version, "updatedAt": now}})
    _database().auth_sessions.update_many({"userId": user_id, "revokedAt": None}, {"$set": {"revokedAt": now}})
    _database().profile_update_logs.insert_one({"user": user_id, "changedFields": ["passwordHash", "mustChangePassword"], "timestamp": now})
    refreshed, expires = _create_shared_session(user_id)
    updated = _database().users.find_one({"_id": user_id})
    sync_event(_database(), "PASSWORD_CHANGED", updated, password=password, version=version)
    response = jsonify({"message": "Your password has been changed.", "user": _public_user(updated)})
    return _shared_cookie(response, refreshed, expires), 200


@auth_bp.get("/shared/me")
def shared_me():
    expected = current_app.config.get("SHARED_SESSION_INTERNAL_SECRET", "")
    supplied = request.headers.get("X-RK-Shared-Auth", "")
    cookie = request.cookies.get(current_app.config["SHARED_SESSION_COOKIE_NAME"], "")
    header_present = bool(supplied)
    secret_match = bool(expected and supplied and hmac.compare_digest(supplied, expected))
    session = None
    session_lookup_db = None
    session_active = False
    session_expired = False
    user = None
    user_active = False
    failure_reason = ""

    if secret_match and cookie:
        session_lookup_db = _database()
        session = session_lookup_db.auth_sessions.find_one({
            "tokenHash": _shared_session_hash(cookie),
            "revokedAt": None,
        })
        expires_at = session.get("expiresAt") if session else None
        if expires_at and expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        now_utc = datetime.now(timezone.utc)
        session_expired = bool(session and expires_at and expires_at <= now_utc)
        session_active = bool(session and expires_at and expires_at > now_utc)
        if session:
            user = session_lookup_db.users.find_one({"_id": session.get("userId")})
            user_active = bool(user and user.get("isActive", True) is not False)

    if not header_present:
        failure_reason = "missing_internal_header"
    elif not secret_match:
        failure_reason = "internal_secret_mismatch"
    elif not cookie:
        failure_reason = "missing_shared_cookie"
    elif not session:
        failure_reason = "session_not_found_or_revoked"
    elif not session_active:
        failure_reason = "session_expired"
    elif not user:
        failure_reason = "user_not_found"
    elif not user_active:
        failure_reason = "user_inactive"

    def log_diagnostic(reason: str):
        current_app.logger.warning(
            "[SHARED_AUTH_DIAG] cookie=%s header=%s secret_match=%s "
            "session_found=%s session_active=%s user_found=%s user_active=%s "
            "role=%s reason=%s",
            bool(cookie), header_present, secret_match, bool(session),
            session_active, bool(user), user_active,
            str((user or {}).get("role") or ""), reason,
        )

    # TEMPORARY LOCAL DIAGNOSTIC: expose status flags only while RK-WEB is
    # explicitly targeting its isolated local test database. Never include
    # credential, cookie, token, header, or secret values in this payload.
    def local_401_payload(error: str, reason: str) -> dict:
        payload = {"error": error}
        local_host = request.host.split(":", 1)[0].lower() in {"localhost", "127.0.0.1", "::1"}
        if current_app.debug and local_host:
            role = (user or {}).get("role")
            runtime_db = _database()
            runtime_metadata = {
                "diagnostic_version": "shared-auth-runtime-v3",
                "runtime_config_dbname": str(current_app.config.get("MONGO_DBNAME") or ""),
                "runtime_db_name": str(runtime_db.name),
                "runtime_users_count": runtime_db.users.count_documents({}),
                "runtime_auth_sessions_count": runtime_db.auth_sessions.count_documents({}),
                "runtime_active_auth_sessions_count": runtime_db.auth_sessions.count_documents({"revokedAt": None}),
                "runtime_admin_exists": bool(runtime_db.users.find_one({"role": "admin"}, {"_id": 1})),
                "runtime_db_object_identity": hex(id(runtime_db)),
                "shared_session_lookup_same_runtime_db": session_lookup_db is runtime_db,
                "shared_session_lookup_returned_document": bool(session),
                "session_lookup_found": bool(session),
            }
            payload["debug"] = {
                "shared_cookie_present": bool(cookie),
                "shared_header_present": header_present,
                "internal_secret_configured": bool(expected),
                "internal_secret_match": secret_match,
                "session_hash_found": bool(session),
                "session_active": session_active,
                "session_expired": session_expired,
                "user_id_present": bool(session and session.get("userId")),
                "user_found": bool(user),
                "user_active": user_active,
                "user_role": role if role in {"admin", "staff", "customer"} else None,
                "failure_reason": reason,
                **runtime_metadata,
            }
            current_app.logger.warning(
                "[SHARED_AUTH_RUNTIME] db_name=%s users=%s auth_sessions=%s "
                "active_auth_sessions=%s session_found=%s",
                runtime_metadata["runtime_db_name"],
                runtime_metadata["runtime_users_count"],
                runtime_metadata["runtime_auth_sessions_count"],
                runtime_metadata["runtime_active_auth_sessions_count"],
                runtime_metadata["shared_session_lookup_returned_document"],
            )
        return payload

    if not expected or not secret_match:
        reason = failure_reason or "internal_auth_failure"
        log_diagnostic(reason)
        return jsonify(local_401_payload("Authentication required.", reason)), 401
    user = _shared_session_user(cookie)
    if not user:
        reason = failure_reason or "session_rejected"
        log_diagnostic(reason)
        return jsonify(local_401_payload("Invalid or expired shared session.", reason)), 401
    log_diagnostic("none")
    return jsonify({"user": _public_user(user)}), 200


@auth_bp.put("/profile")
@requireAuth
def update_profile():
    payload = request.get_json(silent=True) or {}
    user_id = authenticated_user_id()
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
    if "firstName" in updates or "lastName" in updates:
        full_name = f'{updates.get("firstName", current.get("firstName", ""))} {updates.get("lastName", current.get("lastName", ""))}'.strip()
        if full_name:
            updates["displayName"] = full_name
    if "username" in updates:
        if not re.fullmatch(r"[a-zA-Z0-9_.-]{3,30}", updates["username"]):
            return jsonify({"error": "Username must be 3–30 characters and use letters, numbers, dots, dashes, or underscores."}), 400
        duplicate = users.find_one({"username": updates["username"], "_id": {"$ne": user_id}})
        if duplicate:
            return jsonify({"error": "That username is already in use."}), 409
    if "phone" in updates and not re.fullmatch(r"\+?[0-9\s().-]{7,20}", updates["phone"]):
        return jsonify({"error": "A valid phone number is required."}), 400
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
        if gender not in {"male", "female", "prefer-not-to-say"}:
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
    if not str(updates.get("phone", current.get("phone")) or "").strip():
        return jsonify({"error": "Phone number is required."}), 400
    if not updates.get("dob", current.get("dob")):
        return jsonify({"error": "Date of birth is required."}), 400
    if updates.get("gender", current.get("gender")) not in {"male", "female", "prefer-not-to-say"}:
        return jsonify({"error": "Gender is required."}), 400
    if not updates:
        return jsonify({"error": "No profile changes were submitted."}), 400

    now = datetime.now(timezone.utc)
    updates["updatedAt"] = now
    users.update_one({"_id": user_id}, {"$set": updates})
    _database().profile_update_logs.insert_one({"user": user_id, "changedFields": sorted(updates.keys()), "timestamp": now})
    user = _database().users.find_one({"_id": user_id})
    return jsonify({"user": _public_user(user)}), 200


@auth_bp.post("/profile/password/request")
@limiter.limit("5 per 15 minutes")
@requireAuth
def request_password_change():
    user = _database().users.find_one({"_id": authenticated_user_id()})
    if (user or {}).get("role") == "staff":
        return jsonify({"error": "Staff password changes must be performed by an administrator."}), 403
    payload = request.get_json(silent=True) or {}
    password = payload.get("password")
    confirmation = payload.get("confirmPassword")
    if password != confirmation or not _valid_password(password):
        return jsonify({"error": "Passwords must match and contain at least 8 characters."}), 400

    user_id = authenticated_user_id()
    user = _database().users.find_one({"_id": user_id})
    if not user or not user.get("email"):
        return jsonify({"error": "We could not start password verification. Please try again."}), 400

    now = datetime.now(timezone.utc)
    otp = f"{secrets.randbelow(1_000_000):06d}"
    _database().otp_challenges.replace_one(
        {"userId": user_id, "purpose": "password-change"},
        {
            "userId": user_id,
            "purpose": "password-change",
            "otpHash": hashpw(otp.encode(), gensalt()).decode(),
            "otpExpiresAt": now + timedelta(minutes=10),
            "otpAttempts": 0,
            "createdAt": now,
        },
        upsert=True,
    )
    try:
        _send_otp_email(user["email"], otp, "password verification")
    except Exception:
        current_app.logger.exception("Unable to send password-change OTP")
        _database().otp_challenges.delete_one({"userId": user_id, "purpose": "password-change"})
        return jsonify({"error": "We could not send the verification code. Please try again."}), 502
    return jsonify({"message": "A verification code has been sent to your registered email."}), 202


@auth_bp.post("/profile/password/verify")
@limiter.limit("10 per 15 minutes")
@requireAuth
def verify_password_change():
    user = _database().users.find_one({"_id": authenticated_user_id()})
    if (user or {}).get("role") == "staff":
        return jsonify({"error": "Staff password changes must be performed by an administrator."}), 403
    user_id = authenticated_user_id()
    payload = request.get_json(silent=True) or {}
    otp = str(payload.get("otp") or "").strip()
    password = payload.get("password")
    confirmation = payload.get("confirmPassword")
    challenges = _database().otp_challenges
    challenge = challenges.find_one({"userId": user_id, "purpose": "password-change"})
    now = datetime.now(timezone.utc)
    if password != confirmation or not _valid_password(password):
        return jsonify({"error": "Passwords must match and contain at least 8 characters."}), 400
    if not challenge or len(otp) != 6 or _is_expired(challenge.get("otpExpiresAt"), now) or challenge.get("otpAttempts", 0) >= 5:
        return jsonify({"error": "The verification code is invalid or expired."}), 400
    challenges.update_one({"_id": challenge["_id"]}, {"$inc": {"otpAttempts": 1}})
    if not checkpw(otp.encode(), challenge["otpHash"].encode()):
        return jsonify({"error": "The verification code is invalid or expired."}), 400

    version = next_credential_version(user)
    _database().users.update_one(
        {"_id": user_id},
        {"$set": {"passwordHash": _password_hash(password), "credentialVersion": version, "updatedAt": now}},
    )
    challenges.delete_one({"_id": challenge["_id"]})
    user["credentialVersion"] = version
    sync_event(_database(), "PASSWORD_CHANGED", user, password=password, version=version)
    _database().profile_update_logs.insert_one({"user": user_id, "changedFields": ["passwordHash"], "timestamp": now})
    return jsonify({"message": "Your password has been changed."}), 200


def _address_view(address: dict) -> dict:
    fields = ("label", "fullName", "phone", "line1", "line2", "city", "state", "postalCode", "country", "isDefault")
    return {"id": str(address["_id"]), **{key: address.get(key, "") for key in fields}}


@auth_bp.get("/addresses")
@requireAuth
def list_addresses():
    user_id = authenticated_user_id()
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
    user_id = authenticated_user_id()
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
    result = _database().addresses.delete_one({"_id": ObjectId(address_id), "userId": authenticated_user_id()})
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
    user_id = authenticated_user_id()
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
    user_id = authenticated_user_id()
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
    user_id = authenticated_user_id()
    now = datetime.now(timezone.utc)
    _database().users.update_one({"_id": user_id}, {"$set": {"isActive": False, "updatedAt": now, "deletedAt": now}})
    _database().profile_update_logs.insert_one({"user": user_id, "changedFields": ["isActive"], "timestamp": now, "action": "delete"})
    return jsonify({"message": "Your account has been deleted."}), 200


@auth_bp.post("/logout")
@requireAuth
def logout():
    try:
        jwt = get_jwt()
    except RuntimeError:
        jwt = {}
    if jwt.get("jti") and jwt.get("exp"):
        expires_at = datetime.fromtimestamp(jwt["exp"], timezone.utc)
        _database().revoked_tokens.create_index("expiresAt", expireAfterSeconds=0)
        _database().revoked_tokens.update_one(
            {"jti": jwt["jti"]},
            {"$set": {"jti": jwt["jti"], "userId": authenticated_user_id(), "expiresAt": expires_at, "revokedAt": datetime.now(timezone.utc)}},
            upsert=True,
        )
    response = jsonify({"message": "Logged out."})
    unset_jwt_cookies(response)
    token = request.cookies.get(current_app.config["SHARED_SESSION_COOKIE_NAME"])
    if token:
        _database().auth_sessions.update_one({"tokenHash": _shared_session_hash(token), "revokedAt": None}, {"$set": {"revokedAt": datetime.now(timezone.utc)}})
    response.set_cookie(current_app.config["SHARED_SESSION_COOKIE_NAME"], "", expires=0, max_age=0, domain=current_app.config.get("SHARED_SESSION_COOKIE_DOMAIN") or None, path="/", secure=current_app.config.get("SHARED_SESSION_COOKIE_SECURE", True), httponly=True, samesite=current_app.config.get("SHARED_SESSION_COOKIE_SAMESITE", "Lax"))
    return response, 200


@auth_bp.post("/shared/logout")
def shared_logout():
    expected = current_app.config.get("SHARED_SESSION_INTERNAL_SECRET", "")
    supplied = request.headers.get("X-RK-Shared-Auth", "")
    if not expected or not hmac.compare_digest(supplied, expected):
        return jsonify({"error": "Authentication required."}), 401
    token = request.cookies.get(current_app.config["SHARED_SESSION_COOKIE_NAME"], "")
    if token:
        _database().auth_sessions.update_one({"tokenHash": _shared_session_hash(token)}, {"$set": {"revokedAt": datetime.now(timezone.utc)}})
    response = jsonify({"message": "Logged out."})
    response.set_cookie(current_app.config["SHARED_SESSION_COOKIE_NAME"], "", expires=0, max_age=0, domain=current_app.config.get("SHARED_SESSION_COOKIE_DOMAIN") or None, path="/", secure=current_app.config.get("SHARED_SESSION_COOKIE_SECURE", True), httponly=True, samesite=current_app.config.get("SHARED_SESSION_COOKIE_SAMESITE", "Lax"))
    return response, 200
