from app.blueprints.staff.routes import _normalize_catalog_media
from app.catalog_sync_v1 import make_event, validate_event


def test_workdrive_url_is_normalized_without_embed_conversion():
    structured, legacy = _normalize_catalog_media(["https://workdrive.zoho.in/file/abc123"])
    assert legacy == ["https://workdrive.zoho.in/file/abc123"]
    assert structured[0]["provider"] == "zoho_workdrive"
    assert structured[0]["permalink"].endswith("/file/abc123")
    assert "/embed/" not in structured[0]["permalink"]
    validate_event(make_event("MEDIA_CREATED", "media", structured[0]["id"], 1, {
        "media_id": structured[0]["id"], "provider": "zoho_workdrive", "type": "image",
        "permalink": structured[0]["permalink"], "owner_system": "rk-web", "position": 0,
        "is_primary": True,
    }))


def test_cloudinary_url_derives_public_id_and_preserves_owner():
    structured, legacy = _normalize_catalog_media(["https://res.cloudinary.com/demo/image/upload/v123/rk/catalog/look.jpg"])
    assert legacy[0].endswith("look.jpg")
    assert structured[0]["provider"] == "cloudinary"
    assert structured[0]["public_id"] == "rk/catalog/look"
    assert structured[0]["owner_system"] == "rk-web"


def test_unknown_legacy_url_is_preserved_but_not_emitted_as_invalid_v1_media():
    structured, legacy = _normalize_catalog_media(["https://cdn.example.test/look.jpg"])
    assert structured == []
    assert legacy == ["https://cdn.example.test/look.jpg"]
