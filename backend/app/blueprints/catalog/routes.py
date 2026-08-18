from flask import Blueprint, jsonify

from ...catalog import collection_document, collection_view, ensure_catalog_seed, is_excluded_collection, product_document, product_view
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


@catalog_bp.get("/products/<product_id>")
def storefront_product(product_id: str):
    db = database()
    product = product_document(db, product_id)
    if not product:
        return jsonify({"error": "Product not found."}), 404
    object_id = product["_id"]
    collections = [
        collection_view(db, collection, include_products=False)
        for collection in db.collections.find({"productRefs.productId": object_id})
        if not is_excluded_collection(collection)
    ]
    return jsonify({"product": product_view(product), "collections": collections}), 200
