from datetime import datetime, timezone
from time import perf_counter
from collections import OrderedDict
from threading import Lock
from time import monotonic
import html
import re

from flask import Blueprint, Response, current_app, jsonify, request, stream_with_context

from ...catalog import (
    STOREFRONT_COLLECTION_PROJECTION,
    collection_document,
    collection_cover_source,
    collection_hero,
    collection_view,
    collection_product_count,
    collection_display_sort_key,
    is_excluded_collection,
    is_runway_collection,
    product_document,
    product_card_view,
    product_is_runway,
    public_media_version,
    product_view,
    natural_product_sort_key,
)
from ...whatsapp import notify, notify_admins
from ...mail import SENDERS, send_html_email
from ...extensions import limiter
from ...fx_rates import public_currency_context as build_currency_context
from ...product_variants import find_variant, product_has_visible_variants, product_with_computed_variants, sync_product_variants
from ...rbac import database
from ...workdrive import WorkDriveFileNotFound, WorkDriveUnavailable, download_file, is_supported_permalink


catalog_bp = Blueprint("catalog", __name__)

_public_media_cache: OrderedDict[tuple[str, str, str], tuple[float, bytes, str]] = OrderedDict()
_public_media_cache_lock = Lock()
_public_media_fetch_locks = tuple(Lock() for _ in range(64))
_PUBLIC_MEDIA_CACHE_TTL = 900
_PUBLIC_MEDIA_CACHE_MAX_BYTES = 32 * 1024 * 1024
_PUBLIC_MEDIA_CACHE_MAX_ITEM = 8 * 1024 * 1024


def _cached_public_media(key):
    item = _public_media_cache.get(key)
    if not item:
        return None
    expires, body, content_type = item
    if expires <= monotonic():
        _public_media_cache.pop(key, None)
        return None
    _public_media_cache.move_to_end(key)
    return body, content_type


def _store_public_media(key, body, content_type):
    if len(body) > _PUBLIC_MEDIA_CACHE_MAX_ITEM:
        return
    _public_media_cache[key] = (monotonic() + _PUBLIC_MEDIA_CACHE_TTL, body, content_type)
    _public_media_cache.move_to_end(key)
    total = sum(len(value[1]) for value in _public_media_cache.values())
    while total > _PUBLIC_MEDIA_CACHE_MAX_BYTES and _public_media_cache:
        _, (_, old_body, _) = _public_media_cache.popitem(last=False)
        total -= len(old_body)


def _public_media_fetch_lock(key):
    # Striping bounds lock memory while allowing unrelated images to download
    # concurrently. Equal versioned URLs always map to the same lock.
    return _public_media_fetch_locks[hash(key) % len(_public_media_fetch_locks)]


@catalog_bp.get("/currency-context")
def currency_context():
    """Return only the validated conversion data required by the storefront."""
    country = request.headers.get("CF-IPCountry") or request.headers.get("X-Vercel-IP-Country") or ""
    return jsonify(build_currency_context(current_app.config, country_code=country))


def _normalised_values(value):
    values = value if isinstance(value, list) else [value]
    return [str(item or "").strip() for item in values if str(item or "").strip()]


def _shop_product_record(product, memberships):
    record = product_card_view(product, media_limit=2)
    record["collections"] = memberships
    record["collectionIds"] = [item["id"] for item in memberships]
    record["collectionSlugs"] = [item["slug"] for item in memberships]
    attributes = product.get("attributes") if isinstance(product.get("attributes"), dict) else {}
    for key in ("fabric", "material", "occasion"):
        if attributes.get(key):
            record["attributes"][key] = attributes[key]
    visible_ids = {item["id"] for item in record.get("variants") or []}
    record["_search_variant_names"] = [
        str(item.get("name") or "") for item in product.get("variants") or []
        if isinstance(item, dict) and str(item.get("id") or "") in visible_ids
    ]
    record["_search_metadata"] = [str(product.get(key) or "") for key in ("skuPrefix", "style", "shortDescription")]
    record["fulfilmentMode"] = "ready_to_ship" if record.get("availability") == "in_stock" and int(record.get("stock") or 0) > 0 else "made_to_order"
    return record


def _shop_matches(record, *, query="", category="", colour="", size="", collection="", fabric="", fulfilment="", minimum=None, maximum=None):
    attributes = record.get("attributes") if isinstance(record.get("attributes"), dict) else {}
    variants = record.get("variants") if isinstance(record.get("variants"), list) else []
    colours = _normalised_values(attributes.get("colors") or attributes.get("color")) + [str(item.get("colour") or "") for item in variants]
    sizes = _normalised_values(attributes.get("sizes")) + [str(size) for item in variants for size in (item.get("sizes") or [])]
    collections = record.get("collections") if isinstance(record.get("collections"), list) else []
    searchable = " ".join(re.sub(r"[\W_]+", " ", str(value).casefold()).strip() for value in [
        record.get("name"), record.get("sku"), record.get("parentSku"), record.get("skuPrefix"),
        record.get("styleCode"), record.get("style"), record.get("productCode"), record.get("category"),
        record.get("shortDescription"), attributes.get("fabric"), attributes.get("material"), attributes.get("occasion"),
        *record.get("_search_metadata", []), *record.get("_search_variant_names", []), *colours,
        *(value for item in variants for value in (item.get("sku"), item.get("name"), item.get("colourSlug"), item.get("colour"))),
        *(value for item in collections for value in (item.get("name"), item.get("slug"))),
    ] if value)
    query_terms = re.sub(r"[\W_]+", " ", query.casefold()).split()
    price = record.get("price")
    if query and (not query_terms or not all(term in searchable for term in query_terms)):
        return False
    if category and str(record.get("category") or "").casefold() != category.casefold():
        return False
    if colour and not any(item.casefold() == colour.casefold() for item in colours):
        return False
    if size and not any(item.casefold() == size.casefold() for item in sizes):
        return False
    if collection and not any(collection.casefold() in {str(item.get("id") or "").casefold(), str(item.get("slug") or "").casefold()} for item in collections):
        return False
    if fabric and str(attributes.get("fabric") or "").casefold() != fabric.casefold():
        return False
    if fulfilment and record.get("fulfilmentMode") != fulfilment:
        return False
    if minimum is not None and (price is None or price < minimum):
        return False
    if maximum is not None and (price is None or price > maximum):
        return False
    return True


@catalog_bp.get("/products")
def storefront_products():
    db = database()
    collections = [item for item in db.collections.find({}) if not is_excluded_collection(item) and item.get("status") != "archived" and item.get("isActive") is not False]
    memberships = {}
    featured_order = {}
    for collection in collections:
        identity = {"id": str(collection.get("_id") or ""), "name": str(collection.get("name") or ""), "slug": str(collection.get("slug") or "")}
        for ref in collection.get("productRefs") or []:
            product_id = str(ref.get("productId") or "") if isinstance(ref, dict) else ""
            if not product_id:
                continue
            memberships.setdefault(product_id, []).append(identity)
            featured_order[product_id] = min(featured_order.get(product_id, 10**9), int(ref.get("displayOrder") or 0))
    products = [
        product for product in db.products.find({"status": {"$ne": "archived"}, "isActive": {"$ne": False}})
        if product_has_visible_variants(product)
    ]
    records = [_shop_product_record(product, memberships.get(str(product.get("_id") or ""), [])) for product in products]
    def facet_values(values):
        return sorted({str(value).strip() for value in values if str(value or "").strip()}, key=str.casefold)
    facets = {
        "categories": facet_values(item.get("category") for item in records),
        "colours": facet_values(value for item in records for value in _normalised_values((item.get("attributes") or {}).get("colors") or (item.get("attributes") or {}).get("color"))),
        "sizes": facet_values(value for item in records for value in _normalised_values((item.get("attributes") or {}).get("sizes"))),
        "fabrics": facet_values((item.get("attributes") or {}).get("fabric") for item in records),
        "collections": sorted({(collection["id"], collection["name"], collection["slug"]) for item in records for collection in item.get("collections", [])}, key=lambda value: value[1].casefold()),
    }
    def number(name):
        raw = request.args.get(name, "").strip()
        try:
            return float(raw) if raw else None
        except ValueError:
            return None
    filters = {key: request.args.get(key, "").strip() for key in ("q", "category", "colour", "size", "collection", "fabric", "fulfilment")}
    records = [record for record in records if _shop_matches(record, query=filters["q"], category=filters["category"], colour=filters["colour"], size=filters["size"], collection=filters["collection"], fabric=filters["fabric"], fulfilment=filters["fulfilment"], minimum=number("minPrice"), maximum=number("maxPrice"))]
    sort = request.args.get("sort", "featured")
    if sort == "newest":
        records.sort(key=lambda item: (str(item.get("createdAt") or ""), item["id"]), reverse=True)
    elif sort in {"price_asc", "price_desc"}:
        records.sort(key=lambda item: (item.get("price") is None, item.get("price") or 0, item["id"]), reverse=sort == "price_desc")
    else:
        records.sort(key=natural_product_sort_key)
    try:
        page = max(1, int(request.args.get("page", 1)))
        page_size = min(60, max(1, int(request.args.get("pageSize", 24))))
    except ValueError:
        page, page_size = 1, 24
    total = len(records)
    start = (page - 1) * page_size
    products = [{key: value for key, value in record.items() if not key.startswith("_search_")} for record in records[start:start + page_size]]
    response = jsonify({"products": products, "count": total, "page": page, "pageSize": page_size, "facets": facets})
    response.headers["Cache-Control"] = "public, max-age=0, s-maxage=30, stale-while-revalidate=120"
    return response, 200


@catalog_bp.get("/collections")
def storefront_collections():
    db = database()
    existing = [collection for collection in db.collections.find({}) if not is_excluded_collection(collection) and collection.get("status") != "archived" and collection.get("isActive") is not False]
    existing.sort(key=collection_display_sort_key)
    collections = [
        collection_view(db, collection, include_products=False)
        for collection in existing
        if not is_runway_collection(collection)
    ]
    response = jsonify({"collections": collections, "count": len(collections)})
    response.headers["Cache-Control"] = "public, max-age=0, s-maxage=60, stale-while-revalidate=300"
    return response, 200


@catalog_bp.get("/collections/<slug>/hero-image/<slot>")
def storefront_collection_hero_image(slug: str, slot: str):
    if slot not in {"desktop", "mobile", "poster"}:
        return jsonify({"error": "Collection image not found."}), 404
    db = database()
    collection = collection_document(db, slug)
    if not collection or collection.get("status") == "archived" or collection.get("isActive") is False:
        return jsonify({"error": "Collection image not found."}), 404
    hero = collection_hero(collection)
    source = {"desktop": hero["image"], "mobile": hero["mobileImage"], "poster": hero["poster"]}[slot]
    if not source or not is_supported_permalink(source):
        return jsonify({"error": "Collection image not found."}), 404
    try:
        downloaded = download_file(source, db, prefer_preview=True)
    except WorkDriveFileNotFound:
        return jsonify({"error": "Collection image not found."}), 404
    except WorkDriveUnavailable:
        return jsonify({"error": "Collection image is temporarily unavailable."}), 503
    response = Response(downloaded.response.content, status=200, content_type=downloaded.response.headers.get("Content-Type", "application/octet-stream"))
    response.headers["Cache-Control"] = "public, max-age=300, stale-while-revalidate=600"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


@catalog_bp.get("/collections/<slug>/cover-image")
def storefront_collection_cover_image(slug: str):
    db = database()
    collection = collection_document(db, slug)
    if not collection or collection.get("status") == "archived" or collection.get("isActive") is False:
        return jsonify({"error": "Collection image not found."}), 404
    source = collection_cover_source(collection)
    if not source or not is_supported_permalink(source):
        return jsonify({"error": "Collection image not found."}), 404
    try:
        downloaded = download_file(source, db, prefer_preview=True)
    except WorkDriveFileNotFound:
        return jsonify({"error": "Collection image not found."}), 404
    except WorkDriveUnavailable:
        return jsonify({"error": "Collection image is temporarily unavailable."}), 503
    response = Response(downloaded.response.content, status=200, content_type=downloaded.response.headers.get("Content-Type", "application/octet-stream"))
    response.headers["Cache-Control"] = "public, max-age=300, stale-while-revalidate=600"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


@catalog_bp.get("/collections/<slug>/hero-images/<slide_id>/<slot>")
def storefront_collection_hero_slide(slug: str, slide_id: str, slot: str):
    if slot not in {"desktop", "mobile"}:
        return jsonify({"error": "Collection image not found."}), 404
    db = database()
    collection = collection_document(db, slug)
    if not collection or collection.get("status") == "archived" or collection.get("isActive") is False:
        return jsonify({"error": "Collection image not found."}), 404
    slide = next((item for item in collection_hero(collection).get("images", []) if item["id"] == slide_id), None)
    source = slide.get("mobileImage" if slot == "mobile" else "image") if slide else ""
    if not source or not is_supported_permalink(source):
        return jsonify({"error": "Collection image not found."}), 404
    try:
        downloaded = download_file(source, db, prefer_preview=True)
    except WorkDriveFileNotFound:
        return jsonify({"error": "Collection image not found."}), 404
    except WorkDriveUnavailable:
        return jsonify({"error": "Collection image is temporarily unavailable."}), 503
    response = Response(downloaded.response.content, status=200, content_type=downloaded.response.headers.get("Content-Type", "application/octet-stream"))
    response.headers["Cache-Control"] = "public, max-age=300, stale-while-revalidate=600"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


def _request_text(value: object, maximum: int) -> str:
    return str(value or "").strip()[:maximum]


def _runway_collection(db):
    projection = {
        "_id": 1,
        "name": 1,
        "slug": 1,
        "status": 1,
        "collectionType": 1,
        "taxInclusive": 1,
        "description": 1,
        "heroImage": 1,
        "hero": 1,
        "season": 1,
        "year": 1,
        "designerNote": 1,
        "collectionNumber": 1,
        "location": 1,
        "campaignInformation": 1,
        "createdAt": 1,
        "updatedAt": 1,
        "productRefs": 1,
    }
    collections = [collection for collection in db.collections.find({}, projection) if not is_excluded_collection(collection) and collection.get("status") != "archived" and collection.get("isActive") is not False]
    # Prefer the named Lakme/Espiritu chapter if more than one runway record
    # exists, while retaining collectionType=runway as the canonical signal.
    named_runway = next(
        (
            collection
            for collection in collections
            if "lfw" in " ".join(str(collection.get(key) or "").lower() for key in ("name", "slug", "status"))
            or all(token in " ".join(str(collection.get(key) or "").lower() for key in ("name", "slug")) for token in ("espiritu", "libre"))
        ),
        None,
    )
    if named_runway:
        return named_runway
    return next((collection for collection in collections if is_runway_collection(collection)), None)


def _send_custom_order_emails(record: dict) -> None:
    product_name = html.escape(record["productName"])
    customer_name = html.escape(record["customerName"] or "Customer")
    email = html.escape(record["email"], quote=True)
    phone = html.escape(record["phone"] or "Not provided")
    requested_size = html.escape(record["requestedSize"] or "Not specified")
    message = html.escape(record["message"] or "No additional message.")
    measurements = "<br>".join(
        f"{html.escape(key)}: {html.escape(value)}"
        for key, value in record["measurements"].items()
    ) or "Not provided"
    operations_email = current_app.config.get("CUSTOM_ORDER_TO", "operations@chemo.in")

    try:
        send_html_email(
            sender=SENDERS["orders"], recipients=[operations_email], reply_to=[record["email"]],
            subject=f"RK custom order request - {record['productName']}",
            html=(
                "<div style='font-family:Arial,sans-serif;background:#f8f5ef;padding:28px'>"
                "<p style='letter-spacing:.24em;text-transform:uppercase;font-size:11px'>RASHI KAPOOR / CUSTOM ORDER</p>"
                f"<h1 style='font-family:Georgia,serif;font-weight:400'>{product_name}</h1>"
                f"<p><strong>Customer:</strong> {customer_name}<br><strong>Email:</strong> {email}<br>"
                f"<strong>Phone:</strong> {phone}<br><strong>Requested size:</strong> {requested_size}</p>"
                f"<p><strong>Measurements</strong><br>{measurements}</p>"
                f"<p><strong>Request</strong><br>{message}</p></div>"
            ),
        )
    except Exception:
        current_app.logger.exception("Unable to send custom order request to operations")

    try:
        send_html_email(
            sender=SENDERS["orders"], recipients=[record["email"]],
            subject="We received your RK custom order request",
            html=(
                "<div style='font-family:Arial,sans-serif;background:#f8f5ef;padding:32px;color:#27221d'>"
                "<p style='letter-spacing:.28em;text-transform:uppercase;font-size:11px'>RASHI KAPOOR</p>"
                "<h1 style='font-family:Georgia,serif;font-weight:400'>Your request is with the house.</h1>"
                f"<p>Dear {customer_name},</p>"
                f"<p>We received your custom order request for <strong>{product_name}</strong>. "
                "The RK team will review the request and get back to you by email.</p>"
                "<p>Yours sincerely,<br>The Rashi Kapoor Team</p></div>"
            ),
        )
    except Exception:
        current_app.logger.exception("Unable to send custom order acknowledgement")


@catalog_bp.post("/custom-order-requests")
@limiter.limit("8 per hour")
def create_custom_order_request():
    payload = request.get_json(silent=True) or {}
    product_id = _request_text(payload.get("productId"), 120)
    customer_name = _request_text(payload.get("name"), 120)
    email = _request_text(payload.get("email"), 160).lower()
    phone = _request_text(payload.get("phone"), 40)
    requested_size = _request_text(payload.get("requestedSize"), 40)
    message = _request_text(payload.get("message"), 2000)

    if not product_id:
        return jsonify({"error": "Product information is required."}), 400
    if not customer_name:
        return jsonify({"error": "Enter your name."}), 400
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
        return jsonify({"error": "Enter a valid email address."}), 400

    raw_measurements = payload.get("measurements") if isinstance(payload.get("measurements"), dict) else {}
    measurements = {
        _request_text(key, 80): _request_text(value, 40)
        for key, value in raw_measurements.items()
        if _request_text(key, 80) and _request_text(value, 40)
    }

    db = database()
    product = product_document(db, product_id)
    if not product:
        return jsonify({"error": "Product not found."}), 404
    product = sync_product_variants(db, product) or product
    if not product_is_runway(db, product["_id"]):
        return jsonify({"error": "Custom order requests are available only for Runway pieces."}), 403

    variant_id = _request_text(payload.get("variantId"), 120)
    variant = find_variant(product, variant_id) if variant_id else None
    if variant_id and (not variant or str(variant.get("status") or "").lower() == "remove"):
        return jsonify({"error": "The selected colour is no longer available."}), 400

    record = {
        "productId": str(product["_id"]),
        "productName": _request_text(product.get("name"), 200) or "RK piece",
        "variantId": variant_id or None,
        "sku": _request_text((variant or {}).get("sku") or product.get("sku"), 120),
        "colour": _request_text((variant or {}).get("colour"), 120),
        "customerName": customer_name,
        "email": email,
        "phone": phone,
        "requestedSize": requested_size,
        "measurements": measurements,
        "message": message,
        "status": "new",
        "createdAt": datetime.now(timezone.utc),
    }
    result = db.custom_order_requests.insert_one(record)
    record["_id"] = result.inserted_id
    # An anonymous email address must not authorize WhatsApp delivery to a stored account.
    from flask_jwt_extended import get_jwt_identity, verify_jwt_in_request
    try:
        verify_jwt_in_request(optional=True)
        from ...rbac import current_user, _shared_user
        customer = current_user() if get_jwt_identity() else _shared_user()
        if customer and str(customer.get("email", "")).lower() == email:
            db.custom_order_requests.update_one({"_id": record["_id"]}, {"$set": {"customerId": customer["_id"]}})
            notify(db, "custom_order_received", record, user=customer)
    except Exception:
        current_app.logger.warning("Custom request WhatsApp account association unavailable")
    notify_admins(db, record, "custom_order_received")
    _send_custom_order_emails(record)
    return jsonify({
        "requestId": str(result.inserted_id),
        "message": "Request received. The RK team will get back to you by email.",
    }), 201


@catalog_bp.get("/runway")
def storefront_runway():
    started_at = perf_counter()
    db = database()
    collection = _runway_collection(db)
    if not collection:
        return jsonify({"error": "Runway collection not found."}), 404

    raw_limit = request.args.get("limit")
    raw_page = request.args.get("page")
    product_limit = 3 if raw_limit is None else None
    page = 1
    if raw_limit is not None:
        try:
            product_limit = min(12, max(1, int(raw_limit)))
        except (TypeError, ValueError):
            return jsonify({"error": "Runway product limit must be a positive integer."}), 400
    else:
        try:
            page = max(1, int(raw_page or 1))
        except (TypeError, ValueError):
            return jsonify({"error": "Runway page must be a positive integer."}), 400

    payload = collection_view(
        db,
        collection,
        product_media_limit=2,
        product_cards=True,
        product_limit=product_limit,
        product_offset=(page - 1) * product_limit if raw_limit is None else 0,
    )
    total_products = collection_product_count(db, collection)
    payload["productCount"] = total_products
    payload["pagination"] = {
        "page": page,
        "pageSize": product_limit,
        "totalProducts": total_products,
        "totalPages": max(1, (total_products + product_limit - 1) // product_limit),
    }
    current_app.logger.info(
        "runway_perf slug=%s limit=%s total_products=%s total_ms=%.1f",
        collection.get("slug"),
        product_limit,
        payload.get("productCount", 0),
        (perf_counter() - started_at) * 1000,
    )
    response = jsonify({"collection": payload})
    response.headers["Cache-Control"] = "public, max-age=0, s-maxage=60, stale-while-revalidate=300"
    return response, 200


@catalog_bp.get("/collections/<slug>")
def storefront_collection(slug: str):
    started_at = perf_counter()
    db = database()
    collection = collection_document(db, slug, STOREFRONT_COLLECTION_PROJECTION)
    collection_query_ms = (perf_counter() - started_at) * 1000
    if not collection:
        return jsonify({"error": "Collection not found."}), 404
    if collection.get("status") == "archived" or collection.get("isActive") is False:
        return jsonify({"error": "Collection not found."}), 404
    view_started_at = perf_counter()
    raw_page = request.args.get("page")
    is_aakaar = slug.strip().casefold() == "aakaar"
    style_filter = _request_text(request.args.get("style"), 80) if is_aakaar else ""
    colour_filter = _request_text(request.args.get("colour") or request.args.get("color"), 80) if is_aakaar else ""
    page = 1
    product_limit = None
    product_offset = 0
    if raw_page is not None:
        try:
            page = max(1, int(raw_page))
        except (TypeError, ValueError):
            return jsonify({"error": "Collection page must be a positive integer."}), 400
        product_limit = 3
        product_offset = (page - 1) * product_limit

    payload = collection_view(
        db,
        collection,
        product_media_limit=2,
        product_cards=True,
        product_limit=product_limit,
        product_offset=product_offset,
        style=style_filter,
        colour=colour_filter,
    )
    if raw_page is not None:
        total_products = collection_product_count(db, collection, style=style_filter, colour=colour_filter)
        payload["productCount"] = total_products
        payload["pagination"] = {
            "page": page,
            "pageSize": product_limit,
            "totalProducts": total_products,
            "totalPages": max(1, (total_products + product_limit - 1) // product_limit),
        }
    view_ms = (perf_counter() - view_started_at) * 1000
    current_app.logger.info(
        "collection_perf slug=%s collection_query_ms=%.1f transformation_ms=%.1f total_ms=%.1f products=%s",
        slug,
        collection_query_ms,
        view_ms,
        (perf_counter() - started_at) * 1000,
        len(payload.get("products") or []),
    )
    response = jsonify({"collection": payload})
    # Collection content is public and mostly editorial. A short edge cache
    # removes repeat DB work without allowing merchandising status to go stale
    # for more than a few seconds; checkout revalidates variant status/price.
    response.headers["Cache-Control"] = "public, max-age=0, s-maxage=60, stale-while-revalidate=300"
    return response, 200


@catalog_bp.get("/products/<product_id>")
def storefront_product(product_id: str):
    db = database()
    product = product_document(db, product_id)
    if not product:
        return jsonify({"error": "Product not found."}), 404
    product = product_with_computed_variants(db, product) or product
    if not product_has_visible_variants(product):
        return jsonify({"error": "Product not found."}), 404
    object_id = product["_id"]
    collections = [
        collection_view(db, collection, include_products=False)
        for collection in db.collections.find({"productRefs.productId": object_id})
        if not is_excluded_collection(collection)
    ]
    return jsonify({"product": product_view(product), "collections": collections}), 200


@catalog_bp.get("/products/<product_id>/media/<media_id>")
def storefront_product_media(product_id: str, media_id: str):
    """Proxy only WorkDrive images attached to a visible public product."""
    db = database()
    product = product_document(db, product_id)
    if not product or not product_has_visible_variants(product):
        return _media_error("Product media not found.", 404)
    media = next(
        (
            item for item in product.get("catalogMedia") or []
            if isinstance(item, dict)
            and str(item.get("media_id") or item.get("id") or "") == media_id
            and str(item.get("provider") or "").lower() == "zoho_workdrive"
            and str(item.get("type") or "image").lower() == "image"
        ),
        None,
    )
    if not media:
        return _media_error("Product media not found.", 404)
    permalink = str(media.get("permalink") or "")
    version = public_media_version(product_id, media_id, media)
    requested_version = request.args.get("v")
    if requested_version and requested_version != version:
        return _media_error("Product media URL version is no longer current.", 404)
    cache_key = (str(product_id), str(media_id), version)
    if request.if_none_match.contains(version):
        response = Response(status=304)
        response.set_etag(version)
        _set_public_media_cache_headers(response, bool(requested_version))
        return response
    body = None
    content_type = None
    upstream = None
    # Cache lookup and bounded fetch share one process lock. This collapses
    # concurrent WorkDrive requests in a worker without weakening product ACLs:
    # product visibility and media attachment are rechecked above on every hit.
    with _public_media_fetch_lock(cache_key):
        with _public_media_cache_lock:
            cached = _cached_public_media(cache_key)
        if cached:
            body, content_type = cached
        else:
            try:
                download = download_file(permalink, db, prefer_preview=True)
            except WorkDriveFileNotFound:
                _log_workdrive_media_failure("file_not_found", 404)
                return _media_error("Product media not found.", 404)
            except WorkDriveUnavailable as error:
                _log_workdrive_media_failure(error.category, 503)
                return _media_error("Product media is temporarily unavailable.", 503)
            upstream = download.response
            content_type = upstream.headers.get("Content-Type", "application/octet-stream").split(";", 1)[0].strip()
            if not content_type.startswith("image/"):
                upstream.close()
                _log_workdrive_media_failure("unsupported_content_type", 422)
                return _media_error("Product media is not an image.", 422)
            try:
                length = int(upstream.headers.get("Content-Length", ""))
            except (TypeError, ValueError):
                length = _PUBLIC_MEDIA_CACHE_MAX_ITEM + 1
            if 0 <= length <= _PUBLIC_MEDIA_CACHE_MAX_ITEM:
                body = upstream.content
                upstream.close()
                if len(body) <= _PUBLIC_MEDIA_CACHE_MAX_ITEM:
                    with _public_media_cache_lock:
                        _store_public_media(cache_key, body, content_type)
                else:
                    body = None
    if body is not None:
        response = Response(body, content_type=content_type)
    else:
        @stream_with_context
        def content():
            try:
                yield from upstream.iter_content(chunk_size=64 * 1024)
            finally:
                upstream.close()
        response = Response(content(), content_type=content_type)
    _set_public_media_cache_headers(response, bool(requested_version))
    response.set_etag(version)
    response.headers["Content-Disposition"] = "inline"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


def _set_public_media_cache_headers(response, versioned):
    if versioned:
        response.headers["Cache-Control"] = "public, max-age=31536000, immutable, stale-if-error=86400"
        response.headers["CDN-Cache-Control"] = "public, max-age=86400, stale-while-revalidate=300, stale-if-error=86400"
        response.headers["Cloudflare-CDN-Cache-Control"] = "public, max-age=86400, stale-while-revalidate=300, stale-if-error=86400"
    else:
        response.headers["Cache-Control"] = "public, max-age=0, s-maxage=300, stale-while-revalidate=60"
        response.headers["CDN-Cache-Control"] = "public, max-age=300, stale-while-revalidate=60"
        response.headers["Cloudflare-CDN-Cache-Control"] = "public, max-age=300, stale-while-revalidate=60"


def _log_workdrive_media_failure(category, status):
    from ...extensions import resolved_client_address
    _, source = resolved_client_address(current_app.config, request.remote_addr)
    current_app.logger.warning("workdrive_media_failure category=public_product_media status=%s failure=%s key_type=not_rate_limited ip_source=%s",
                               status, category, source)


def _media_error(message, status):
    response = jsonify({"error": message})
    response.status_code = status
    response.headers["Cache-Control"] = "no-store"
    response.headers["Cloudflare-CDN-Cache-Control"] = "no-store"
    response.headers["CDN-Cache-Control"] = "no-store"
    return response
