import base64
import io
import os
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from PIL import Image
from flask import Flask

from app.ai_tryon import GeminiProviderError, SUPPORTED_MODELS, _api_key, _call_gemini, _catalog_image, _validate_generated_jpeg, _validate_image
from app.workdrive import WorkDriveDownload


def image_bytes(fmt="PNG", size=(80, 100)):
    stream = io.BytesIO()
    Image.new("RGB", size, (190, 160, 120)).save(stream, format=fmt)
    return stream.getvalue()


def test_supported_models_are_explicit_and_current_default_is_available():
    assert "gemini-nano-banana-2.1" in SUPPORTED_MODELS
    assert "gemini-3.1-flash-image" in SUPPORTED_MODELS


def test_gemini_key_is_read_only_from_backend_environment():
    database = SimpleNamespace(admin_settings=SimpleNamespace(find_one=lambda _query: {"aiTryonApiKey": "legacy-ciphertext"}))
    with patch("app.ai_tryon.database", return_value=database), patch.dict(os.environ, {"GEMINI_API_KEY": "environment-only-test-key"}, clear=False):
        assert _api_key() == "environment-only-test-key"


def test_validate_image_checks_content_not_only_extension():
    assert _validate_image(image_bytes("PNG"), "image/png", 1024 * 1024, 512) == "image/png"
    with pytest.raises(ValueError, match="corrupted"):
        _validate_image(b"not an image", "image/png", 1024 * 1024, 512)


def test_validate_image_rejects_dimensions_and_unsupported_types():
    with pytest.raises(ValueError, match="no larger"):
        _validate_image(image_bytes("JPEG", (900, 100)), "image/jpeg", 1024 * 1024, 512)
    with pytest.raises(ValueError, match="JPEG, PNG, or WebP"):
        _validate_image(image_bytes("PNG"), "image/gif", 1024 * 1024, 512)


def test_gemini_call_sends_two_images_and_redacts_key_from_url():
    output = image_bytes("JPEG")
    response = SimpleNamespace(ok=True, json=lambda: {"interaction": {"output_image": {"data": base64.b64encode(output).decode()}}})
    with patch("app.ai_tryon.requests.post", return_value=response) as post:
        result = _call_gemini("secret-key", "gemini-nano-banana-2.1", "controlled prompt", image_bytes("JPEG"), "image/jpeg", image_bytes("PNG"), "image/png", 10)
    assert result == output
    request = post.call_args.kwargs
    assert request["headers"] == {"x-goog-api-key": "secret-key"}
    assert "secret-key" not in str(request.get("params"))
    assert len(request["json"]["input"]) == 3
    assert request["json"]["response_format"] == {"type": "image", "mime_type": "image/jpeg"}


@pytest.mark.parametrize("customer_format", ["PNG", "JPEG"])
def test_gemini_always_requests_jpeg_output_independent_of_customer_input(customer_format):
    output = image_bytes("JPEG")
    response = SimpleNamespace(ok=True, json=lambda: {"interaction": {"output_image": {"data": base64.b64encode(output).decode()}}})
    with patch("app.ai_tryon.requests.post", return_value=response) as post:
        _call_gemini("secret-key", "gemini-nano-banana-2.1", "prompt", image_bytes(customer_format), f"image/{customer_format.lower()}", image_bytes("PNG"), "image/png", 10)
    assert post.call_args.kwargs["json"]["response_format"] == {"type": "image", "mime_type": "image/jpeg"}


def test_generated_jpeg_is_validated_by_bytes_and_dimensions():
    output = image_bytes("JPEG", (120, 160))
    assert _validate_generated_jpeg(output) == output
    with pytest.raises(GeminiProviderError, match="unsupported output MIME"):
        _validate_generated_jpeg(output, "image/png")
    with pytest.raises(GeminiProviderError, match="valid JPEG"):
        _validate_generated_jpeg(image_bytes("PNG"), "image/jpeg")


def test_generated_result_is_served_as_jpeg(tmp_path):
    from app.ai_tryon import ai_tryon_bp

    filename = "generation.jpg"
    (tmp_path / filename).write_bytes(image_bytes("JPEG"))
    database = SimpleNamespace(ai_tryon_generations=SimpleNamespace(find_one=lambda _query: {"_id": "generation-1", "ownerKey": "guest:owner", "status": "succeeded", "filename": filename}))
    app = Flask(__name__)
    app.register_blueprint(ai_tryon_bp, url_prefix="/api")
    with patch("app.ai_tryon.database", return_value=database), patch("app.ai_tryon._identity", return_value=("guest:owner", "guest", "token")), patch("app.ai_tryon._store_root", return_value=tmp_path):
        response = app.test_client().get("/api/ai-tryon/result/generation-1")
    assert response.status_code == 200
    assert response.content_type == "image/jpeg"


@pytest.mark.parametrize(
    ("status", "provider_status", "expected_code"),
    [(401, "UNAUTHENTICATED", "authentication_or_permission"), (403, "PERMISSION_DENIED", "authentication_or_permission"), (404, "NOT_FOUND", "invalid_model"), (429, "RESOURCE_EXHAUSTED", "quota_or_rate_limit")],
)
def test_gemini_http_failures_are_classified_without_exposing_credentials(status, provider_status, expected_code):
    response = SimpleNamespace(ok=False, status_code=status, json=lambda: {"error": {"status": provider_status, "message": "request rejected"}}, close=lambda: None)
    with patch("app.ai_tryon.requests.post", return_value=response), patch.dict(os.environ, {"GEMINI_API_KEY": "secret-key"}, clear=False):
        with pytest.raises(GeminiProviderError) as raised:
            _call_gemini("secret-key", "gemini-nano-banana-2.1", "prompt", image_bytes(), "image/png", image_bytes(), "image/png", 10)
    assert raised.value.code == expected_code
    assert "secret-key" not in str(raised.value)
    assert raised.value.public_message


def test_gemini_timeout_is_sanitized():
    with patch("app.ai_tryon.requests.post", side_effect=__import__("requests").Timeout("timed out")):
        with pytest.raises(GeminiProviderError) as raised:
            _call_gemini("secret-key", "gemini-nano-banana-2.1", "prompt", image_bytes(), "image/png", image_bytes(), "image/png", 10)
    assert raised.value.code == "timeout"
    assert "secret-key" not in str(raised.value)


def test_gemini_extracts_image_from_interaction_steps_when_convenience_output_is_absent():
    output = image_bytes("JPEG")
    response = SimpleNamespace(ok=True, json=lambda: {"interaction": {"steps": [{"type": "model_output", "content": [{"type": "image", "data": base64.b64encode(output).decode()}]}]}}, close=lambda: None)
    with patch("app.ai_tryon.requests.post", return_value=response):
        assert _call_gemini("secret-key", "gemini-nano-banana-2.1", "prompt", image_bytes(), "image/png", image_bytes(), "image/png", 10) == output


def test_gemini_missing_image_output_is_actionable():
    response = SimpleNamespace(ok=True, json=lambda: {"interaction": {"output_text": "I could not create an image."}}, close=lambda: None)
    with patch("app.ai_tryon.requests.post", return_value=response):
        with pytest.raises(GeminiProviderError, match="no image output"):
            _call_gemini("secret-key", "gemini-nano-banana-2.1", "prompt", image_bytes(), "image/png", image_bytes(), "image/png", 10)


def test_catalog_image_resolves_real_product_media_reference_through_workdrive(monkeypatch):
    raw = image_bytes("JPEG", (120, 160))
    upstream = MagicMock()
    upstream.headers = {"Content-Type": "image/jpeg"}
    upstream.iter_content.return_value = [raw]
    product = {
        "_id": "6adda708971eb7cdde741605",
        "variants": [{
            "id": "colour:blue",
            "status": "active",
            "imageMeta": [{
                "id": "ad89c30b71cf397b15b6fba2b3b2c092",
                "provider": "zoho_workdrive",
                "type": "image",
                "variant_id": "colour:blue",
                "permalink": "https://workdrive.zoho.in/file/private123",
            }],
        }],
        "catalogMedia": [],
        "media": [],
    }
    database = SimpleNamespace()
    with patch("app.ai_tryon.database", return_value=database), patch(
        "app.ai_tryon.download_file",
        return_value=WorkDriveDownload(upstream, "private123"),
    ) as download:
        result, mime, error = _catalog_image(product, "colour:blue")
    assert result == raw
    assert mime == "image/jpeg"
    assert error is None
    download.assert_called_once_with("https://workdrive.zoho.in/file/private123", database, prefer_preview=True)
    upstream.close.assert_called_once()


def test_catalog_image_prioritizes_the_requested_current_gallery_reference():
    first = image_bytes("JPEG", (120, 160))
    second = image_bytes("PNG", (140, 180))
    first_response = MagicMock()
    first_response.headers = {"Content-Type": "image/jpeg"}
    first_response.iter_content.return_value = [first]
    second_response = MagicMock()
    second_response.headers = {"Content-Type": "image/png"}
    second_response.iter_content.return_value = [second]
    product = {
        "_id": "6adda708971eb7cdde741605",
        "variants": [{"id": "colour:blue", "status": "active", "imageMeta": []}],
        "catalogMedia": [
            {"id": "primary", "provider": "zoho_workdrive", "type": "image", "variant_id": "colour:blue", "permalink": "https://workdrive.zoho.in/file/primary"},
            {"id": "current", "provider": "zoho_workdrive", "type": "image", "variant_id": "colour:blue", "permalink": "https://workdrive.zoho.in/file/current"},
        ],
        "media": [],
    }
    database = SimpleNamespace()
    with patch("app.ai_tryon.database", return_value=database), patch(
        "app.ai_tryon.download_file",
        side_effect=[WorkDriveDownload(second_response, "current"), WorkDriveDownload(first_response, "primary")],
    ) as download:
        result, mime, error = _catalog_image(
            product,
            "colour:blue",
            "/api/catalog/products/6adda708971eb7cdde741605/media/current?v=version",
        )
    assert result == second
    assert mime == "image/png"
    assert error is None
    assert download.call_args_list[0].args[0].endswith("/current")


def test_catalog_image_does_not_cross_variant_and_returns_actionable_error():
    product = {
        "variants": [{
            "id": "colour:blue", "status": "active", "imageMeta": [], "images": [],
        }, {
            "id": "colour:red", "status": "active", "imageMeta": [{
                "provider": "zoho_workdrive", "type": "image", "variant_id": "colour:red",
                "permalink": "https://workdrive.zoho.in/file/red-only",
            }],
        }],
        "catalogMedia": [], "media": [],
    }
    with patch("app.ai_tryon.download_file") as download:
        result, mime, error = _catalog_image(product, "colour:blue")
    assert result is None
    assert mime is None
    assert "selected product variant" in error
    download.assert_not_called()
