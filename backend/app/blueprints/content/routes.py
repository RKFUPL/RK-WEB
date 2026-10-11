from flask import Blueprint, jsonify, Response, stream_with_context

from ...rbac import database
from ...time_utils import json_value as serialize_json_value
from ...workdrive import WorkDriveFileNotFound, WorkDriveUnavailable, download_file


content_bp = Blueprint("content", __name__)


@content_bp.get("/testimonials")
def published_testimonials():
    items = database().testimonials.find({"status": "published"}).sort([("displayOrder", 1), ("createdAt", -1)])
    return jsonify({"items": [{
        "id": str(item["_id"]),
        "displayName": item.get("displayName", ""),
        "text": item.get("text", ""),
        "imageUrl": item.get("imageUrl") or (f"/api/content/testimonials/{item['_id']}/image" if isinstance(item.get("imageMedia"), dict) else None),
        "contextLabel": item.get("contextLabel") or None,
        "displayOrder": int(item.get("displayOrder") or 0),
        "updatedAt": serialize_json_value(item.get("updatedAt")),
    } for item in items]}), 200


@content_bp.get("/testimonials/<testimonial_id>/image")
def published_testimonial_image(testimonial_id: str):
    from bson import ObjectId

    if not ObjectId.is_valid(testimonial_id):
        return jsonify({"error": "Testimonial image not found."}), 404
    item = database().testimonials.find_one({"_id": ObjectId(testimonial_id), "status": "published"})
    media = item.get("imageMedia") if item and isinstance(item.get("imageMedia"), dict) else None
    if not media or media.get("provider") != "zoho_workdrive":
        return jsonify({"error": "Testimonial image not found."}), 404
    try:
        download = download_file(str(media.get("permalink") or ""), database(), prefer_preview=True)
    except WorkDriveFileNotFound:
        return jsonify({"error": "Testimonial image not found."}), 404
    except WorkDriveUnavailable:
        return jsonify({"error": "Testimonial image is temporarily unavailable."}), 503

    upstream = download.response
    content_type = upstream.headers.get("Content-Type", "application/octet-stream").split(";", 1)[0].strip()
    if not content_type.startswith("image/"):
        upstream.close()
        return jsonify({"error": "Testimonial media is not an image."}), 422

    @stream_with_context
    def content():
        try:
            yield from upstream.iter_content(chunk_size=64 * 1024)
        finally:
            upstream.close()

    response = Response(content(), content_type=content_type)
    response.headers["Cache-Control"] = "public, max-age=300, stale-while-revalidate=3600"
    response.headers["Content-Disposition"] = "inline"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response
