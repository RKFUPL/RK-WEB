from __future__ import annotations

import os
import re
import secrets
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from hashlib import sha256
from html.parser import HTMLParser
from urllib.parse import urlencode, urlparse

import requests
from cryptography.fernet import Fernet, InvalidToken


_FILE_ID = re.compile(r"^[A-Za-z0-9]+$")
_EXTERNAL_SHARE_ID = re.compile(r"^[A-Za-z0-9]+$")
_token_lock = threading.Lock()
_token: tuple[str, float] | None = None
_status_lock = threading.Lock()
_status = {
    "last_token_refresh_at": None,
    "last_file_retrieval_at": None,
    "last_error_category": None,
}
_OAUTH_SCOPE = "WorkDrive.files.READ"
_OAUTH_STATE_TTL_SECONDS = 600


class WorkDriveUnavailable(RuntimeError):
    def __init__(self, message: str, category: str = "provider_unavailable"):
        super().__init__(message)
        self.category = category


class WorkDriveFileNotFound(RuntimeError):
    category = "file_not_found"


@dataclass(frozen=True)
class WorkDriveDownload:
    response: requests.Response
    file_id: str


class _OpenGraphImageParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.image_url: str | None = None

    def handle_starttag(self, tag: str, attrs) -> None:
        if tag.lower() != "meta" or self.image_url:
            return
        values = {str(key).lower(): value for key, value in attrs}
        if values.get("property", "").lower() == "og:image":
            self.image_url = str(values.get("content") or "").strip() or None


def file_id_from_permalink(value: str) -> str | None:
    parsed = urlparse(str(value or "").strip())
    if parsed.scheme != "https" or parsed.hostname != "workdrive.zoho.in":
        return None
    parts = [part for part in parsed.path.split("/") if part]
    if len(parts) != 2 or parts[0] != "file" or not _FILE_ID.fullmatch(parts[1]):
        return None
    return parts[1]


def external_share_id_from_permalink(value: str) -> str | None:
    parsed = urlparse(str(value or "").strip())
    if parsed.scheme != "https" or parsed.hostname != "workdrive.zohoexternal.in":
        return None
    parts = [part for part in parsed.path.split("/") if part]
    if len(parts) != 2 or parts[0] not in {"external", "file"} or not _EXTERNAL_SHARE_ID.fullmatch(parts[1]):
        return None
    return parts[1]


def is_supported_permalink(value: str) -> bool:
    return bool(file_id_from_permalink(value) or external_share_id_from_permalink(value))


def _record_status(**values) -> None:
    with _status_lock:
        _status.update(values)


def _token_cipher() -> Fernet | None:
    key = os.getenv("ZOHO_WORKDRIVE_TOKEN_ENCRYPTION_KEY", "").strip()
    if not key:
        return None
    try:
        return Fernet(key.encode("ascii"))
    except (ValueError, TypeError):
        return None


def _stored_refresh_token(db) -> str:
    if db is None or _token_cipher() is None:
        return ""
    stored = db.integrations.find_one({"_id": "zoho_workdrive"}, {"encryptedRefreshToken": 1}) or {}
    encrypted = str(stored.get("encryptedRefreshToken") or "").strip()
    if not encrypted:
        return ""
    try:
        return _token_cipher().decrypt(encrypted.encode("ascii")).decode("utf-8").strip()
    except (InvalidToken, ValueError, UnicodeError):
        _record_status(last_error_category="credential_store_invalid")
        return ""


def _refresh_token(db=None) -> str:
    return _stored_refresh_token(db) or os.getenv("ZOHO_WORKDRIVE_REFRESH_TOKEN", "").strip()


def oauth_configuration() -> dict:
    redirect_uri = os.getenv("ZOHO_WORKDRIVE_REDIRECT_URI", "").strip()
    parsed = urlparse(redirect_uri)
    redirect_valid = (
        parsed.scheme in {"http", "https"}
        and bool(parsed.netloc)
        and parsed.path == "/api/admin/integrations/workdrive/oauth/callback"
        and not parsed.params and not parsed.query and not parsed.fragment
    )
    return {
        "client_id": bool(os.getenv("ZOHO_WORKDRIVE_CLIENT_ID", "").strip()),
        "client_secret": bool(os.getenv("ZOHO_WORKDRIVE_CLIENT_SECRET", "").strip()),
        "redirect_uri": bool(redirect_uri),
        "redirect_uri_valid": redirect_valid,
        "token_encryption_key": _token_cipher() is not None,
    }


def safe_status(db=None) -> dict:
    configured = {
        "client_id": bool(os.getenv("ZOHO_WORKDRIVE_CLIENT_ID", "").strip()),
        "client_secret": bool(os.getenv("ZOHO_WORKDRIVE_CLIENT_SECRET", "").strip()),
        "refresh_token": bool(_refresh_token(db)),
    }
    with _status_lock:
        state = dict(_status)
    stored_connection = db.integrations.find_one({"_id": "zoho_workdrive"}, {"status": 1}) if db is not None else None
    connected = bool(configured["refresh_token"] and ((stored_connection or {}).get("status") == "connected" or state["last_token_refresh_at"]))
    status = "connected" if connected and not state["last_error_category"] else "error" if state["last_error_category"] else "not_connected"
    return {"provider": "zoho_workdrive", "status": status, "configured": configured, **state}


def _oauth_error_category(payload: object) -> str:
    error = str(payload.get("error") or "") if isinstance(payload, dict) else ""
    if error in {"invalid_client", "invalid_code", "invalid_grant"}:
        return "authentication_failed"
    if error in {"invalid_scope", "scope_mismatch"}:
        return "permission_denied"
    return "oauth_failed"


def _access_token(force_refresh: bool = False, db=None) -> str:
    global _token
    now = time.monotonic()
    if not force_refresh and _token and _token[1] > now:
        return _token[0]

    with _token_lock:
        now = time.monotonic()
        if not force_refresh and _token and _token[1] > now:
            return _token[0]

        client_id = os.getenv("ZOHO_WORKDRIVE_CLIENT_ID", "").strip()
        client_secret = os.getenv("ZOHO_WORKDRIVE_CLIENT_SECRET", "").strip()
        refresh_token = _refresh_token(db)
        if not all((client_id, client_secret, refresh_token)):
            _record_status(last_error_category="missing_configuration")
            raise WorkDriveUnavailable("WorkDrive OAuth is not configured.", "missing_configuration")

        try:
            response = requests.post(
                "https://accounts.zoho.in/oauth/v2/token",
                data={
                    "refresh_token": refresh_token,
                    "client_id": client_id,
                    "client_secret": client_secret,
                    "grant_type": "refresh_token",
                },
                timeout=15,
            )
            payload = response.json()
        except (requests.RequestException, ValueError) as error:
            _record_status(last_error_category="oauth_unavailable")
            raise WorkDriveUnavailable("Unable to authenticate with WorkDrive.", "oauth_unavailable") from error

        access_token = str(payload.get("access_token") or "").strip()
        if not access_token:
            category = _oauth_error_category(payload)
            _record_status(last_error_category=category)
            raise WorkDriveUnavailable("Unable to authenticate with WorkDrive.", category)
        expires_in = max(60, int(payload.get("expires_in") or 3600))
        _token = (access_token, now + expires_in - 60)
        _record_status(last_token_refresh_at=datetime.now(timezone.utc).isoformat(), last_error_category=None)
        return access_token


def test_connection(db=None) -> dict:
    _access_token(force_refresh=True, db=db)
    return safe_status(db)


def _metadata_download_url(file_id: str, access_token: str) -> str:
    try:
        response = requests.get(
            f"https://www.zohoapis.in/workdrive/api/v1/files/{file_id}",
            headers={
                "Authorization": f"Zoho-oauthtoken {access_token}",
                "Accept": "application/vnd.api+json",
            },
            timeout=(10, 45),
        )
        payload = response.json()
    except (requests.RequestException, ValueError) as error:
        raise WorkDriveUnavailable("Unable to retrieve WorkDrive file metadata.", "download_unavailable") from error
    if response.status_code == 401:
        raise WorkDriveUnavailable("WorkDrive rejected the access token.", "authentication_failed")
    if response.status_code == 403:
        raise WorkDriveUnavailable("WorkDrive denied file access.", "permission_denied")
    if response.status_code == 404:
        raise WorkDriveFileNotFound("The configured WorkDrive file was not found.")
    if not response.ok:
        category = "rate_limited" if response.status_code == 429 else "provider_unavailable"
        raise WorkDriveUnavailable("Unable to retrieve WorkDrive file metadata.", category)
    attributes = ((payload.get("data") or {}).get("attributes") or {})
    download_url = str(attributes.get("download_url") or "").strip()
    parsed = urlparse(download_url)
    if (
        parsed.scheme != "https"
        or parsed.hostname not in {"download.zoho.in", "download-accl.zoho.in"}
        or not parsed.path.startswith(f"/v1/workdrive/download/{file_id}")
    ):
        raise WorkDriveUnavailable("WorkDrive did not provide a safe download URL.", "unsupported_response")
    return download_url


def _preview_image_url(file_id: str, access_token: str) -> str:
    try:
        response = requests.get(
            f"https://www.zohoapis.in/workdrive/api/v1/files/{file_id}/previewinfo",
            headers={
                "Authorization": f"Zoho-oauthtoken {access_token}",
                "Accept": "application/vnd.api+json",
            },
            timeout=(10, 45),
        )
        payload = response.json()
    except (requests.RequestException, ValueError) as error:
        raise WorkDriveUnavailable("Unable to retrieve WorkDrive preview metadata.", "download_unavailable") from error
    if response.status_code == 401:
        raise WorkDriveUnavailable("WorkDrive rejected the access token.", "authentication_failed")
    if response.status_code == 403:
        raise WorkDriveUnavailable("WorkDrive denied preview access.", "permission_denied")
    if response.status_code == 404:
        raise WorkDriveFileNotFound("The configured WorkDrive file was not found.")
    if not response.ok:
        category = "rate_limited" if response.status_code == 429 else "provider_unavailable"
        raise WorkDriveUnavailable("Unable to retrieve WorkDrive preview metadata.", category)
    attributes = ((payload.get("data") or {}).get("attributes") or {})
    preview_url = str(attributes.get("preview_data_url") or "").strip()
    parsed = urlparse(preview_url)
    if parsed.scheme != "https" or parsed.hostname != "previewengine-accl.zoho.in" or not parsed.path:
        raise WorkDriveUnavailable("WorkDrive did not provide a safe image preview.", "unsupported_response")
    return preview_url


def begin_oauth(db, user_id: str) -> str:
    client_id = os.getenv("ZOHO_WORKDRIVE_CLIENT_ID", "").strip()
    redirect_uri = os.getenv("ZOHO_WORKDRIVE_REDIRECT_URI", "").strip()
    if not all(oauth_configuration().values()):
        raise WorkDriveUnavailable("WorkDrive OAuth connect is not configured.", "connect_not_configured")
    state = secrets.token_urlsafe(32)
    now = datetime.now(timezone.utc)
    db.oauth_states.delete_many({"provider": "zoho_workdrive", "expiresAt": {"$lte": now}})
    db.oauth_states.insert_one({
        "provider": "zoho_workdrive",
        "stateHash": sha256(state.encode("utf-8")).hexdigest(),
        "userId": str(user_id),
        "createdAt": now,
        "expiresAt": datetime.fromtimestamp(now.timestamp() + _OAUTH_STATE_TTL_SECONDS, tz=timezone.utc),
    })
    query = urlencode({
        "scope": _OAUTH_SCOPE,
        "client_id": client_id,
        "response_type": "code",
        "access_type": "offline",
        "prompt": "consent",
        "redirect_uri": redirect_uri,
        "state": state,
    })
    return f"https://accounts.zoho.in/oauth/v2/auth?{query}"


def complete_oauth(db, state: str, code: str) -> None:
    if not state or not code:
        raise WorkDriveUnavailable("WorkDrive OAuth callback is incomplete.", "invalid_callback")
    now = datetime.now(timezone.utc)
    state_record = db.oauth_states.find_one_and_delete({
        "provider": "zoho_workdrive",
        "stateHash": sha256(state.encode("utf-8")).hexdigest(),
        "expiresAt": {"$gt": now},
    })
    if not state_record:
        raise WorkDriveUnavailable("WorkDrive OAuth state is invalid or expired.", "invalid_state")
    client_id = os.getenv("ZOHO_WORKDRIVE_CLIENT_ID", "").strip()
    client_secret = os.getenv("ZOHO_WORKDRIVE_CLIENT_SECRET", "").strip()
    redirect_uri = os.getenv("ZOHO_WORKDRIVE_REDIRECT_URI", "").strip()
    cipher = _token_cipher()
    if not all((client_id, client_secret, redirect_uri)) or cipher is None:
        raise WorkDriveUnavailable("WorkDrive OAuth connect is not configured.", "connect_not_configured")
    try:
        response = requests.post("https://accounts.zoho.in/oauth/v2/token", data={
            "grant_type": "authorization_code",
            "client_id": client_id,
            "client_secret": client_secret,
            "redirect_uri": redirect_uri,
            "code": code,
        }, timeout=15)
        payload = response.json()
    except (requests.RequestException, ValueError) as error:
        raise WorkDriveUnavailable("Unable to complete WorkDrive OAuth.", "oauth_unavailable") from error
    refresh_token = str(payload.get("refresh_token") or "").strip()
    if not refresh_token:
        raise WorkDriveUnavailable("WorkDrive did not return a refresh token.", _oauth_error_category(payload))
    db.integrations.update_one({"_id": "zoho_workdrive"}, {"$set": {
        "provider": "zoho_workdrive",
        "status": "connected",
        "encryptedRefreshToken": cipher.encrypt(refresh_token.encode("utf-8")).decode("ascii"),
        "scope": _OAUTH_SCOPE,
        "connectedAt": now,
        "connectedBy": state_record.get("userId"),
    }}, upsert=True)
    global _token
    _token = None
    _record_status(last_error_category=None)


def download_file(permalink: str, db=None, prefer_preview: bool = False) -> WorkDriveDownload:
    file_id = file_id_from_permalink(permalink)
    external_share_id = external_share_id_from_permalink(permalink)
    if not file_id and not external_share_id:
        raise WorkDriveFileNotFound("The configured WorkDrive file is invalid.")
    try:
        if external_share_id:
            share_response = requests.get(permalink, timeout=(10, 45))
            if not share_response.ok:
                response = share_response
            else:
                parser = _OpenGraphImageParser()
                parser.feed(share_response.text)
                preview_url = parser.image_url
                share_response.close()
                preview = urlparse(preview_url or "")
                if preview.scheme != "https" or preview.hostname != "previewengine.zohoexternal.in":
                    raise WorkDriveUnavailable("WorkDrive did not provide a safe image preview.", "unsupported_response")
                response = requests.get(preview_url, stream=True, timeout=(10, 45))
        else:
            access_token = _access_token(db=db)
            download_url = _preview_image_url(file_id, access_token) if prefer_preview else _metadata_download_url(file_id, access_token)
            response = requests.get(
                download_url,
                headers={"Authorization": f"Zoho-oauthtoken {access_token}"},
                stream=True,
                timeout=(10, 45),
            )
    except requests.RequestException as error:
        _record_status(last_error_category="download_unavailable")
        raise WorkDriveUnavailable("Unable to retrieve the WorkDrive file.", "download_unavailable") from error
    if response.status_code == 401:
        response.close()
        _record_status(last_error_category="authentication_failed")
        raise WorkDriveUnavailable("WorkDrive rejected the access token.", "authentication_failed")
    if response.status_code == 403:
        response.close()
        _record_status(last_error_category="permission_denied")
        raise WorkDriveUnavailable("WorkDrive denied file access.", "permission_denied")
    if response.status_code == 404:
        response.close()
        _record_status(last_error_category="file_not_found")
        raise WorkDriveFileNotFound("The configured WorkDrive file was not found.")
    if not response.ok:
        category = "rate_limited" if response.status_code == 429 else "unsupported_request" if response.status_code == 400 else "provider_unavailable"
        response.close()
        _record_status(last_error_category=category)
        raise WorkDriveUnavailable("Unable to retrieve the WorkDrive file.", category)
    _record_status(last_file_retrieval_at=datetime.now(timezone.utc).isoformat(), last_error_category=None)
    return WorkDriveDownload(response=response, file_id=file_id or external_share_id or "")
