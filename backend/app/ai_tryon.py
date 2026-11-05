"""Private, quota-limited Gemini image generation for product try-on previews.

The feature is deliberately fail-closed: it is disabled by default, accepts
only uploaded image bytes from customers, and reads the Google credential only
from the backend environment.
"""
from __future__ import annotations

import base64
import hashlib
import io
import json
import os
import secrets
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import quote, unquote, urlparse

import requests
from bson import ObjectId
from flask import Blueprint, current_app, jsonify, make_response, request, send_file
from PIL import Image, UnidentifiedImageError

from .catalog import product_document
from .extensions import limiter
from .rbac import current_user, database, requireAdmin
from .workdrive import WorkDriveFileNotFound, WorkDriveUnavailable, download_file

ai_tryon_bp = Blueprint("ai_tryon", __name__)

SUPPORTED_MODELS = {
    "gemini-nano-banana-2.1": "Nano Banana 2.1",
    "gemini-3.1-flash-image": "Nano Banana 2",
    "gemini-3-pro-image": "Nano Banana Pro",
    "gemini-2.5-flash-image": "Nano Banana (legacy)",
    "gemini-3.1-flash-lite-image": "Nano Banana 2 Lite",
}
ALLOWED_INPUTS = {"image/jpeg": ("JPEG",), "image/png": ("PNG",), "image/webp": ("WEBP",)}
DEFAULTS = {
    "enabled": False,
    "allowGuests": False,
    "allowLoggedIn": True,
    "model": "gemini-nano-banana-2.1",
    "instructions": "",
    "maxGenerationsPerCustomerPerDay": 3,
    "maxGenerationsPerIpPerDay": 10,
    "maxUploadBytes": 10 * 1024 * 1024,
    "maxImageDimension": 4096,
    "generationTimeoutSeconds": 90,
    "maxConcurrentRequests": 2,
    "retentionDays": 7,
    "productEligibilityDefault": False,
}
_CONCURRENCY = threading.BoundedSemaphore(DEFAULTS["maxConcurrentRequests"])


class GeminiProviderError(RuntimeError):
    def __init__(self, code, message, *, status=None, public_message=None):
        super().__init__(message)
        self.code = code
        self.status = status
        self.public_message = public_message or "The AI Try-On service is temporarily unavailable. Please try again."


def _safe_provider_message(value):
    message = " ".join(str(value or "").split())
    key = _api_key()
    if key:
        message = message.replace(key, "[REDACTED_KEY]")
    return message[:300] or "No provider detail returned"


def _provider_error(response, fallback_code="provider_error"):
    status = getattr(response, "status_code", None)
    payload = {}
    try:
        payload = response.json() or {}
    except (ValueError, TypeError):
        payload = {}
    error = payload.get("error") if isinstance(payload, dict) else None
    if isinstance(error, dict):
        detail = error.get("message") or error.get("status") or ""
        provider_code = str(error.get("status") or error.get("code") or fallback_code).lower()
    else:
        detail = payload.get("message") if isinstance(payload, dict) else ""
        provider_code = fallback_code
    if status in {401, 403} or provider_code in {"unauthenticated", "permission_denied", "permissiondenied"}:
        code = "authentication_or_permission"
        public = "The AI Try-On service rejected its credentials or model access. Please contact the store team."
    elif status == 404 or provider_code in {"not_found", "notfound"}:
        code = "invalid_model"
        public = "The selected AI model is unavailable. Please contact the store team."
    elif status == 429 or provider_code in {"resource_exhausted", "ratelimited", "rate_limit_exceeded"}:
        code = "quota_or_rate_limit"
        public = "The AI Try-On service is temporarily at capacity. Please try again later."
    elif status and 400 <= int(status) < 500:
        code = "invalid_request"
        public = "The AI Try-On request was rejected. Please try again or contact the store team."
    else:
        code = "provider_error"
        public = "The AI Try-On service is temporarily unavailable. Please try again."
    return GeminiProviderError(code, _safe_provider_message(detail), status=status, public_message=public)


def _now():
    return datetime.now(timezone.utc)


def _settings():
    stored = database().admin_settings.find_one({"_id": "store"}) or {}
    saved = stored.get("aiTryon") if isinstance(stored.get("aiTryon"), dict) else {}
    result = {**DEFAULTS, **{key: value for key, value in saved.items() if key in DEFAULTS}}
    # Deployment-level kill switch: the admin toggle is necessary but cannot
    # override an environment that has not explicitly opted into the feature.
    result["enabled"] = bool(result["enabled"]) and os.getenv("AI_TRYON_ENABLED", "false").strip().lower() == "true"
    return result


def _api_key():
    """Read the credential exclusively from the backend process environment."""
    return os.getenv("GEMINI_API_KEY", "").strip()


def _safe_config():
    settings = _settings()
    return {**settings, "apiKeyConfigured": bool(_api_key()), "credentialSource": "backend_environment"}


def _identity():
    user = current_user()
    if user and user.get("_id"):
        return f"user:{user['_id']}", "user", ""
    token = request.cookies.get("rk_tryon_guest", "")
    if not token:
        token = secrets.token_urlsafe(32)
    return f"guest:{hashlib.sha256(token.encode()).hexdigest()}", "guest", token


def _validate_image(raw: bytes, declared: str, max_bytes: int, max_dimension: int):
    if len(raw) > max_bytes:
        raise ValueError(f"Your photo must be smaller than {max_bytes // (1024 * 1024)} MB.")
    if declared not in ALLOWED_INPUTS:
        raise ValueError("Please upload a JPEG, PNG, or WebP photo.")
    try:
        image = Image.open(io.BytesIO(raw))
        image.verify()
        image = Image.open(io.BytesIO(raw))
    except (UnidentifiedImageError, OSError, ValueError) as error:
        raise ValueError("That image is corrupted or could not be read.") from error
    if image.format not in ALLOWED_INPUTS[declared]:
        raise ValueError("The file content does not match a supported image format.")
    if max(image.size) > max_dimension:
        raise ValueError(f"Your photo must be no larger than {max_dimension}px on its longest side.")
    return declared


def _read_catalog_response(response, max_bytes=20 * 1024 * 1024):
    chunks = []
    total = 0
    try:
        for chunk in response.iter_content(chunk_size=64 * 1024):
            if not chunk:
                continue
            total += len(chunk)
            if total > max_bytes:
                raise ValueError("The catalog image is larger than the supported limit.")
            chunks.append(chunk)
        return b"".join(chunks)
    finally:
        close = getattr(response, "close", None)
        if close:
            close()


def _catalog_image_bytes(raw, content_type):
    declared = str(content_type or "").split(";", 1)[0].strip().lower()
    # WorkDrive previews can occasionally return a generic content type. The
    # bytes are still decoded and restricted to the same supported formats;
    # no extension or URL is trusted.
    if declared not in ALLOWED_INPUTS:
        if declared not in {"", "application/octet-stream"}:
            raise ValueError("The catalog image has an unsupported MIME type.")
        with Image.open(io.BytesIO(raw)) as image:
            detected = {"JPEG": "image/jpeg", "PNG": "image/png", "WEBP": "image/webp"}.get(image.format)
        if not detected:
            raise ValueError("The catalog image is not a supported JPEG, PNG, or WebP image.")
        declared = detected
    return raw, _validate_image(raw, declared, 20 * 1024 * 1024, 8192)


def _catalog_image_sources(product, variant_id=None, requested_ref=None):
    selected_id = str(variant_id or "").strip()
    selected_variant = None
    if selected_id:
        selected_variant = next(
            (
                variant for variant in product.get("variants") or []
                if isinstance(variant, dict)
                and str(variant.get("_id") or variant.get("id") or "") == selected_id
                and variant.get("status") != "remove"
            ),
            None,
        )

    def record_source(item):
        if not isinstance(item, dict) or str(item.get("type") or "image").lower() != "image":
            return ""
        provider = str(item.get("provider") or "").strip().lower()
        if provider == "zoho_workdrive":
            return str(item.get("permalink") or "").strip()
        if provider == "cloudinary":
            return str(item.get("secure_url") or item.get("url") or "").strip()
        return ""

    sources = []
    if selected_variant:
        for item in selected_variant.get("imageMeta") or []:
            value = record_source(item)
            if value:
                sources.append(value)
        for value in selected_variant.get("images") or []:
            text = str(value or "").strip()
            if text.startswith("https://"):
                sources.append(text)

    structured = [item for item in product.get("catalogMedia") or [] if isinstance(item, dict)]
    if selected_id:
        structured = [item for item in structured if str(item.get("variant_id") or "") == selected_id]
    else:
        structured = [item for item in structured if not item.get("variant_id")]
    sources.extend(value for value in (record_source(item) for item in structured) if value)

    # A parent/product-level gallery is a safe same-product fallback when the
    # selected variant has no retrievable image. Never use another variant's
    # gallery as a fallback.
    parent_sources = [
        str(value or "").strip()
        for value in product.get("media") or []
        if str(value or "").strip().startswith("https://")
    ]
    parent_sources.extend(
        value for value in (
            record_source(item)
            for item in product.get("catalogMedia") or []
            if isinstance(item, dict) and not item.get("variant_id")
        ) if value
    )
    sources.extend(parent_sources)
    sources = list(dict.fromkeys(sources))

    requested_source = ""
    requested = str(requested_ref or "").strip()
    parsed_requested = urlparse(requested)
    path_parts = [unquote(part) for part in parsed_requested.path.split("/") if part]
    if len(path_parts) >= 6 and path_parts[:3] == ["api", "catalog", "products"] and path_parts[3] == str(product.get("_id") or "") and path_parts[4] == "media":
        requested_media_id = path_parts[5]
        requested_source = next(
            (
                record_source(item) for item in structured
                if str(item.get("media_id") or item.get("id") or "") == requested_media_id
            ),
            "",
        )
    elif parsed_requested.scheme == "https" and parsed_requested.hostname == "res.cloudinary.com" and requested in sources:
        requested_source = requested
    if requested_source:
        sources.remove(requested_source)
        sources.insert(0, requested_source)
    return sources


def _catalog_image(product, variant_id=None, requested_ref=None):
    sources = _catalog_image_sources(product, variant_id, requested_ref)
    if not sources:
        return None, None, "The selected product variant does not have a supported catalog image."
    for source in sources:
        parsed = urlparse(source)
        try:
            if parsed.scheme == "https" and parsed.hostname == "workdrive.zoho.in":
                download = download_file(source, database(), prefer_preview=True)
                raw = _read_catalog_response(download.response)
                image, mime = _catalog_image_bytes(raw, download.response.headers.get("Content-Type"))
                return image, mime, None
            if parsed.scheme == "https" and parsed.hostname == "workdrive.zohoexternal.in":
                download = download_file(source, database(), prefer_preview=True)
                raw = _read_catalog_response(download.response)
                image, mime = _catalog_image_bytes(raw, download.response.headers.get("Content-Type"))
                return image, mime, None
            if parsed.scheme == "https" and parsed.hostname == "res.cloudinary.com":
                response = requests.get(source, timeout=20, headers={"User-Agent": "RK-WEB AI try-on"}, stream=True)
                response.raise_for_status()
                raw = _read_catalog_response(response)
                image, mime = _catalog_image_bytes(raw, response.headers.get("Content-Type"))
                return image, mime, None
        except (requests.RequestException, ValueError, OSError, WorkDriveFileNotFound, WorkDriveUnavailable):
            continue
    return None, None, "The selected product image could not be retrieved or decoded. Choose another saved catalog image for this product."


def _validate_generated_jpeg(raw, reported_mime=None):
    if reported_mime and str(reported_mime).split(";", 1)[0].strip().lower() != "image/jpeg":
        raise GeminiProviderError(
            "invalid_image_output",
            "Gemini returned an unsupported output MIME type",
            public_message="The AI Try-On service returned an unsupported image format. Please try again.",
        )
    try:
        _validate_image(raw, "image/jpeg", 20 * 1024 * 1024, 8192)
    except ValueError as error:
        raise GeminiProviderError(
            "invalid_image_output",
            "Gemini returned bytes that are not a valid JPEG image",
            public_message="The AI Try-On service returned an invalid JPEG image. Please try again.",
        ) from error
    return raw


def _prompt(settings, product):
    extra = str(settings.get("instructions") or "").strip()
    return """Create a realistic fashion try-on preview using the customer's photo and the selected Rashi Kapoor Official catalog garment image. Preserve the customer's recognizable identity, natural facial features, skin tone, pose and body proportions. Reproduce the garment faithfully: exact color, fabric appearance, embroidery, patterns, silhouette and design details. Make it appear naturally worn with realistic lighting, shadows, perspective and fabric draping. Do not redesign the garment, add unrelated accessories or embellishments, or alter the face/body unnecessarily. This is a visual preview only, not an exact fit, sizing, measurement, or purchase guarantee.""" + (f"\nAdditional approved direction: {extra}" if extra else "") + f"\nProduct name: {str(product.get('name') or 'selected garment')[:160]}"


def _call_gemini(api_key, model, prompt, customer_bytes, customer_mime, product_bytes, product_mime, timeout):
    body = {"model": model, "input": [
        {"type": "text", "text": prompt},
        {"type": "image", "mime_type": customer_mime, "data": base64.b64encode(customer_bytes).decode()},
        {"type": "image", "mime_type": product_mime, "data": base64.b64encode(product_bytes).decode()},
    ], "response_format": {"type": "image", "mime_type": "image/jpeg"}}
    try:
        response = requests.post(
            "https://generativelanguage.googleapis.com/v1beta/interactions",
            headers={"x-goog-api-key": api_key},
            json=body,
            timeout=(10, timeout),
        )
    except requests.Timeout as error:
        raise GeminiProviderError("timeout", "Gemini request timed out", public_message="The AI Try-On service timed out. Please try again.") from error
    except requests.RequestException as error:
        raise GeminiProviderError("network_error", _safe_provider_message(error), public_message="The AI Try-On service could not be reached. Please try again.") from error
    try:
        if not response.ok:
            raise _provider_error(response)
        try:
            payload = response.json()
        except (ValueError, TypeError) as error:
            raise GeminiProviderError("invalid_response", "Gemini returned invalid JSON", public_message="The AI Try-On service returned an invalid response. Please try again.") from error
    finally:
        close = getattr(response, "close", None)
        if close:
            close()

    interaction = payload.get("interaction") if isinstance(payload, dict) else None
    interaction = interaction if isinstance(interaction, dict) else payload
    output = interaction.get("output_image") if isinstance(interaction, dict) else None
    data = output.get("data") if isinstance(output, dict) else None
    output_mime = output.get("mime_type") if isinstance(output, dict) else None
    if not data and isinstance(interaction, dict):
        for step in interaction.get("steps") or []:
            contents = step.get("content") or [] if isinstance(step, dict) else []
            for content in contents:
                if isinstance(content, dict) and content.get("type") == "image" and content.get("data"):
                    data = content["data"]
                    output_mime = content.get("mime_type")
                    break
            if data:
                break
    if not isinstance(data, str) or not data:
        raise GeminiProviderError("missing_image_output", "Gemini returned no image output", public_message="The AI Try-On service did not return an image. Please try again.")
    try:
        generated = base64.b64decode(data, validate=True)
    except (ValueError, TypeError) as error:
        raise GeminiProviderError("invalid_image_output", "Gemini returned invalid image data", public_message="The AI Try-On service returned an invalid image. Please try again.") from error
    return _validate_generated_jpeg(generated, output_mime)


def _owner_filter(generation_id, identity):
    return {"_id": generation_id, "ownerKey": identity}


def _store_root():
    root = Path(current_app.instance_path) / "private" / "ai_tryon"
    root.mkdir(parents=True, exist_ok=True)
    return root


@ai_tryon_bp.get("/ai-tryon/config")
def public_config():
    settings = _settings()
    return jsonify({"enabled": bool(settings["enabled"]), "allowGuests": bool(settings["allowGuests"]), "allowLoggedIn": bool(settings["allowLoggedIn"]), "model": settings["model"]})


@ai_tryon_bp.post("/ai-tryon/generate")
@limiter.limit("30 per hour")
def generate():
    settings = _settings()
    user = current_user()
    if not settings["enabled"]:
        return jsonify({"error": "AI Try-On is currently unavailable."}), 503
    if user and not settings["allowLoggedIn"] or not user and not settings["allowGuests"]:
        return jsonify({"error": "Please sign in to use AI Try-On."}), 401
    product_id = str(request.form.get("productId") or "").strip()
    if not ObjectId.is_valid(product_id):
        return jsonify({"error": "A valid product is required."}), 400
    product = product_document(database(), product_id)
    if not product or product.get("status") == "archived" or product.get("isActive") is False or product.get("aiTryonEnabled") is not True:
        return jsonify({"error": "AI Try-On is not available for this product."}), 404
    upload = request.files.get("photo")
    if not upload or not upload.filename:
        return jsonify({"error": "Please choose a photo first."}), 400
    try:
        customer_bytes = upload.read()
        customer_mime = _validate_image(customer_bytes, (upload.mimetype or "").lower(), int(settings["maxUploadBytes"]), int(settings["maxImageDimension"]))
    except ValueError as error:
        return jsonify({"error": str(error)}), 422
    product_bytes, product_mime, catalog_error = _catalog_image(product, request.form.get("variantId"), request.form.get("imageRef"))
    if not product_bytes:
        return jsonify({"error": catalog_error or "This product does not have a suitable catalog image."}), 422
    if not _api_key() or settings["model"] not in SUPPORTED_MODELS:
        return jsonify({"error": "AI Try-On has not been configured by the store."}), 503
    identity, identity_type, guest_token = _identity()
    day = _now().strftime("%Y-%m-%d")
    usage = database().ai_tryon_generations.count_documents({"ownerKey": identity, "day": day})
    if usage >= int(settings["maxGenerationsPerCustomerPerDay"]):
        return jsonify({"error": "You have reached today's Try-On limit."}), 429
    ip_hash = hashlib.sha256((request.remote_addr or "unknown").encode()).hexdigest()
    if database().ai_tryon_generations.count_documents({"ipHash": ip_hash, "day": day}) >= int(settings["maxGenerationsPerIpPerDay"]):
        return jsonify({"error": "Try-On is temporarily limited. Please try again later."}), 429
    generation_id = secrets.token_urlsafe(18)
    started = time.monotonic()
    record = {"_id": generation_id, "ownerKey": identity, "ownerType": identity_type, "ipHash": ip_hash, "day": day, "productId": product_id, "model": settings["model"], "status": "processing", "createdAt": _now()}
    database().ai_tryon_generations.insert_one(record)
    try:
        if not _CONCURRENCY.acquire(timeout=2):
            raise RuntimeError("Try-On is busy; please retry shortly")
        try:
            generated = _call_gemini(_api_key(), settings["model"], _prompt(settings, product), customer_bytes, customer_mime, product_bytes, product_mime, int(settings["generationTimeoutSeconds"]))
        finally:
            _CONCURRENCY.release()
        output_mime = "image/jpeg"
        _validate_generated_jpeg(generated, output_mime)
        filename = f"{generation_id}.jpg"
        (_store_root() / filename).write_bytes(generated)
        database().ai_tryon_generations.update_one({"_id": generation_id}, {"$set": {"status": "succeeded", "filename": filename, "durationMs": int((time.monotonic() - started) * 1000), "completedAt": _now()}})
        response = make_response(jsonify({"generation": {"id": generation_id, "status": "succeeded", "imageUrl": f"/api/ai-tryon/result/{generation_id}"}}), 201)
        if identity_type == "guest":
            response.set_cookie("rk_tryon_guest", guest_token, httponly=True, samesite="Lax", secure=current_app.config.get("JWT_COOKIE_SECURE", True), max_age=86400)
        return response
    except Exception as error:
        provider_code = getattr(error, "code", "unexpected_error")
        provider_status = getattr(error, "status", None)
        safe_message = _safe_provider_message(error)
        current_app.logger.warning(
            "AI try-on generation failed: class=%s code=%s status=%s detail=%s",
            type(error).__name__, provider_code, provider_status or "none", safe_message,
            exc_info=True,
        )
        database().ai_tryon_generations.update_one({"_id": generation_id}, {"$set": {"status": "failed", "errorCode": type(error).__name__, "durationMs": int((time.monotonic() - started) * 1000), "completedAt": _now()}})
        return jsonify({"error": getattr(error, "public_message", "We couldn't create that preview. Please try again.")}), 502


@ai_tryon_bp.get("/ai-tryon/result/<generation_id>")
def result(generation_id):
    identity, _, _ = _identity()
    record = database().ai_tryon_generations.find_one(_owner_filter(generation_id, identity))
    if not record or record.get("status") != "succeeded":
        return jsonify({"error": "Try-On result not found."}), 404
    path = _store_root() / str(record.get("filename") or "")
    if not path.is_file() or path.parent != _store_root():
        return jsonify({"error": "Try-On result not found."}), 404
    return send_file(path, mimetype="image/jpeg", max_age=0, conditional=True)


@ai_tryon_bp.get("/ai-tryon/history")
def history():
    identity, _, _ = _identity()
    rows = database().ai_tryon_generations.find({"ownerKey": identity, "status": "succeeded"}, {"_id": 1, "productId": 1, "createdAt": 1}).sort("createdAt", -1).limit(30)
    return jsonify({"history": [{"id": row["_id"], "productId": str(row.get("productId") or ""), "createdAt": row.get("createdAt"), "imageUrl": f"/api/ai-tryon/result/{row['_id']}"} for row in rows]})


@ai_tryon_bp.delete("/ai-tryon/history/<generation_id>")
def delete_history(generation_id):
    identity, _, _ = _identity()
    row = database().ai_tryon_generations.find_one(_owner_filter(generation_id, identity))
    if not row:
        return jsonify({"error": "Try-On result not found."}), 404
    filename = row.get("filename")
    if filename:
        path = _store_root() / str(filename)
        if path.parent == _store_root() and path.is_file(): path.unlink()
    database().ai_tryon_generations.delete_one(_owner_filter(generation_id, identity))
    return "", 204


@ai_tryon_bp.get("/admin/ai-tryon/config")
@requireAdmin
def admin_config():
    return jsonify({"config": _safe_config(), "models": SUPPORTED_MODELS})


@ai_tryon_bp.put("/admin/ai-tryon/config")
@requireAdmin
def update_admin_config():
    payload = request.get_json(silent=True) or {}
    if "apiKey" in payload:
        return jsonify({"error": "Gemini API keys must be changed in the backend environment, not in the dashboard."}), 400
    settings = _settings()
    for key in DEFAULTS:
        if key in payload: settings[key] = payload[key]
    if settings["model"] not in SUPPORTED_MODELS: return jsonify({"error": "Unsupported Gemini image model."}), 400
    numeric = {"maxGenerationsPerCustomerPerDay": (1, 100), "maxGenerationsPerIpPerDay": (1, 500), "maxUploadBytes": (1_048_576, 25 * 1024 * 1024), "maxImageDimension": (512, 8192), "generationTimeoutSeconds": (10, 180), "maxConcurrentRequests": (1, 10), "retentionDays": (1, 90)}
    for key, (minimum, maximum) in numeric.items():
        try: settings[key] = int(settings[key])
        except (TypeError, ValueError): return jsonify({"error": f"{key} must be a number."}), 400
        if not minimum <= settings[key] <= maximum: return jsonify({"error": f"{key} is outside the allowed range."}), 400
    update = {"aiTryon": settings, "updatedAt": _now(), "updatedBy": current_user()["_id"]}
    # Remove any legacy encrypted credential left by the previous implementation;
    # no dashboard request can create or replace it anymore.
    database().admin_settings.update_one({"_id": "store"}, {"$set": update, "$unset": {"aiTryonApiKey": ""}}, upsert=True)
    return jsonify({"config": _safe_config(), "models": SUPPORTED_MODELS})


@ai_tryon_bp.post("/admin/ai-tryon/test-connection")
@requireAdmin
def test_connection():
    key = _api_key(); model = _settings()["model"]
    if not key: return jsonify({"error": "No Gemini API key is configured."}), 503
    if model not in SUPPORTED_MODELS:
        return jsonify({"error": "The selected Gemini image model is not supported by this deployment."}), 400
    try:
        response = requests.get(
            f"https://generativelanguage.googleapis.com/v1beta/models/{quote(model, safe='')}",
            headers={"x-goog-api-key": key},
            timeout=(10, 15),
        )
        try:
            if not response.ok:
                raise _provider_error(response)
            database().admin_settings.update_one({"_id": "store"}, {"$set": {"aiTryonLastTestAt": _now(), "aiTryonLastError": None}}, upsert=True)
            return jsonify({"ok": True, "model": model, "testedAt": _now()})
        finally:
            close = getattr(response, "close", None)
            if close:
                close()
    except requests.Timeout as error:
        failure = GeminiProviderError("timeout", "Gemini model check timed out", public_message="The Gemini model check timed out. Please try again.")
        current_app.logger.warning("AI try-on connection test failed: class=%s code=%s detail=%s", type(error).__name__, failure.code, failure, exc_info=True)
        database().admin_settings.update_one({"_id": "store"}, {"$set": {"aiTryonLastError": failure.code, "aiTryonLastTestAt": _now()}}, upsert=True)
        return jsonify({"error": failure.public_message}), 502
    except requests.RequestException as error:
        failure = GeminiProviderError("network_error", _safe_provider_message(error), public_message="The Gemini model check could not reach Google. Please try again.")
        current_app.logger.warning("AI try-on connection test failed: class=%s code=%s detail=%s", type(error).__name__, failure.code, failure, exc_info=True)
        database().admin_settings.update_one({"_id": "store"}, {"$set": {"aiTryonLastError": failure.code, "aiTryonLastTestAt": _now()}}, upsert=True)
        return jsonify({"error": failure.public_message}), 502
    except GeminiProviderError as error:
        current_app.logger.warning("AI try-on connection test failed: class=%s code=%s status=%s detail=%s", type(error).__name__, error.code, error.status or "none", error, exc_info=True)
        database().admin_settings.update_one({"_id": "store"}, {"$set": {"aiTryonLastError": error.code, "aiTryonLastTestAt": _now()}}, upsert=True)
        return jsonify({"error": error.public_message}), 502
    except Exception as error:
        current_app.logger.warning("AI try-on connection test failed: class=%s code=unexpected_error detail=%s", type(error).__name__, _safe_provider_message(error), exc_info=True)
        database().admin_settings.update_one({"_id": "store"}, {"$set": {"aiTryonLastError": "unexpected_error", "aiTryonLastTestAt": _now()}}, upsert=True)
        return jsonify({"error": "The Gemini model check failed unexpectedly. Please try again."}), 502


@ai_tryon_bp.get("/admin/ai-tryon/usage")
@requireAdmin
def usage():
    db = database(); now = _now(); month = now.strftime("%Y-%m")
    pipeline = [{"$group": {"_id": {"status": "$status", "model": "$model"}, "count": {"$sum": 1}}}]
    grouped = list(db.ai_tryon_generations.aggregate(pipeline))
    return jsonify({"usage": {"total": sum(int(row["count"]) for row in grouped), "successful": sum(int(row["count"]) for row in grouped if row["_id"].get("status") == "succeeded"), "failed": sum(int(row["count"]) for row in grouped if row["_id"].get("status") == "failed"), "byModel": [{"model": row["_id"].get("model"), "status": row["_id"].get("status"), "count": row["count"]} for row in grouped], "month": month}})


@ai_tryon_bp.post("/admin/ai-tryon/products/<product_id>")
@requireAdmin
def product_eligibility(product_id):
    if not ObjectId.is_valid(product_id): return jsonify({"error": "Invalid product id."}), 400
    enabled = bool((request.get_json(silent=True) or {}).get("enabled"))
    result = database().products.update_one({"_id": ObjectId(product_id)}, {"$set": {"aiTryonEnabled": enabled, "updatedAt": _now()}})
    if not result.matched_count: return jsonify({"error": "Product not found."}), 404
    return jsonify({"productId": product_id, "enabled": enabled})


def cleanup_expired():
    """Explicit maintenance hook; call from the existing scheduled job."""
    cutoff = _now() - timedelta(days=int(_settings()["retentionDays"]))
    for row in database().ai_tryon_generations.find({"createdAt": {"$lt": cutoff}}, {"filename": 1}):
        path = _store_root() / str(row.get("filename") or "")
        if path.parent == _store_root() and path.is_file(): path.unlink()
    database().ai_tryon_generations.delete_many({"createdAt": {"$lt": cutoff}})
