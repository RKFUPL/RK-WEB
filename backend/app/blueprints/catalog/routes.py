from flask import Blueprint, jsonify

from ...catalog import collection_document, collection_view, ensure_catalog_seed
from ...rbac import database


catalog_bp = Blueprint("catalog", __name__)


@catalog_bp.get("/collections/<slug>")
def storefront_collection(slug: str):
    db = database()
    ensure_catalog_seed(db)
    collection = collection_document(db, slug)
    if not collection:
        return jsonify({"error": "Collection not found."}), 404
    return jsonify({"collection": collection_view(db, collection)}), 200
