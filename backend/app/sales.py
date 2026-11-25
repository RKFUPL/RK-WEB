"""Durable sale relationships; base catalogue prices are never mutated.

Overlaps use lowest effective INR price, then campaign ID as a stable tie break.
Every public request resolves publication/time/eligibility again. No cron required.
"""
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from io import BytesIO
from gridfs import GridFSBucket
import re
import secrets
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from bson import ObjectId
from flask import Blueprint, Response, g, has_request_context, jsonify, request, stream_with_context
from PIL import Image, UnidentifiedImageError
from pymongo import ReturnDocument

from .rbac import database, current_user, requirePermission, requireAdmin
from .product_variants import visible_variants
from .time_utils import json_value
from .campaign_media import CampaignMediaError, SUPPORTED

sales_bp = Blueprint('sales', __name__)
TYPES = {'festive', 'annual', 'thrift', 'clearance', 'seasonal', 'wedding', 'custom'}
MAX_IMAGE = 5 * 1024 * 1024
MAX_VIDEO = 100 * 1024 * 1024


@sales_bp.after_request
def no_cached_sale_prices(response):
    response.headers['Cache-Control'] = 'no-store'
    response.headers['CDN-Cache-Control'] = 'no-store'
    return response


def utcnow():
    return datetime.now(timezone.utc)


def aware(value):
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def money(value):
    try:
        amount = Decimal(str(value))
        if not amount.is_finite() or amount <= 0:
            raise ValueError('Price must be positive and finite.')
        return amount.quantize(Decimal('.01'), rounding=ROUND_HALF_UP)
    except (InvalidOperation, TypeError):
        raise ValueError('Price must be positive and finite.')


def discounted(mrp, percent):
    try:
        discount = Decimal(str(percent))
        if not discount.is_finite() or not 0 < discount < 100:
            raise ValueError('Discount must be greater than 0 and less than 100.')
        price = (money(mrp) * (1 - discount / 100)).quantize(Decimal('.01'), rounding=ROUND_HALF_UP)
        if price <= 0:
            raise ValueError('Sale price must be positive.')
        return float(price)
    except InvalidOperation:
        raise ValueError('Choose a valid discount.')


def eligible(product, variant=None):
    return (product.get('status') == 'active' and product.get('isActive') is not False
            and (variant is None or (variant.get('status') == 'active' and bool(variant.get('id')) and bool(str(variant.get('sku') or '').strip()))))


def campaign_state(campaign, now=None):
    now = now or utcnow()
    state = campaign.get('publication', 'draft')
    if state in ('draft', 'paused', 'archived'):
        return state
    if now >= aware(campaign['endsAt']):
        return 'expired'
    return 'scheduled' if now < aware(campaign['startsAt']) else 'live'


def active_campaigns(db, now):
    if (db.admin_settings.find_one({'_id': 'store'}) or {}).get('salePageEnabled') is not True:
        return []
    return list(db.sale_campaigns.find({'publication': 'published', 'startsAt': {'$lte': now}, 'endsAt': {'$gt': now}}, {'bannerData': 0}))


def effective_catalog_price(db, product, variant=None, now=None, campaigns=None):
    """INR only. Clients cannot supply campaign evidence or discounted amounts."""
    now = now or utcnow()
    base = variant.get('price') if variant and variant.get('priceMode') == 'override' and variant.get('price') is not None else product.get('price')
    try:
        mrp = float(money(base))
    except ValueError:
        return {'mrp': base, 'effectivePrice': base, 'salePrice': None, 'discountPercent': 0, 'isOnSale': False, 'saleCampaignId': None, 'saleEndsAt': None, 'serverTime': json_value(now)}
    result = {'mrp': mrp, 'effectivePrice': mrp, 'salePrice': None, 'discountPercent': 0, 'isOnSale': False, 'saleCampaignId': None, 'saleEndsAt': None, 'serverTime': json_value(now)}
    if not eligible(product, variant):
        return result
    matches = []
    for campaign in campaigns if campaigns is not None else active_campaigns(db, now):
        if campaign_state(campaign, now) != 'live':
            continue
        for item in campaign.get('items', []):
            if str(item['productId']) != str(product['_id']):
                continue
            if item.get('variantId') and (not variant or item['variantId'] != str(variant.get('id'))):
                continue
            if variant and 'targetSkus' in item and not any(t.get('variantId') == str(variant.get('id')) and t.get('sku') == variant.get('sku') for t in item['targetSkus']):
                continue
            try:
                matches.append((discounted(mrp, item['discountPercent']), str(campaign['_id']), campaign, item))
            except ValueError:
                continue
    if matches:
        price, cid, campaign, item = min(matches, key=lambda row: row[:2])
        result.update(effectivePrice=price, salePrice=price, discountPercent=item['discountPercent'], isOnSale=True,
                      saleCampaignId=cid, saleCampaignName=campaign['title'], saleItemId=item['id'], saleEndsAt=json_value(campaign['endsAt']))
    return result


def public_prices(product, result):
    """Attach live prices only to public serializers; admin editors retain MRP."""
    if not has_request_context() or request.blueprint not in ('catalog', 'sales') or request.endpoint == 'sales.selection':
        return result
    if request.blueprint == 'catalog':
        from .blueprints.catalog.routes import database as catalog_database
        db = catalog_database()
    else:
        db = database()
    if not hasattr(g, 'sale_price_context'):
        now = utcnow()
        g.sale_price_context = (now, active_campaigns(db, now))
    now, campaigns = g.sale_price_context
    for row in result.get('variants', []):
        source = next((v for v in product.get('variants', []) if str(v.get('id')) == row['id']), row)
        price = effective_catalog_price(db, product, source, now, campaigns)
        row.update(price=price['effectivePrice'], sale=price)
    selected = next((v for v in result.get('variants', []) if v.get('status') == 'active'), None)
    price = selected['sale'] if selected else effective_catalog_price(db, product, None, now, campaigns)
    result.update(price=price['effectivePrice'], sale=price)
    return result


def text(value, limit=300):
    return re.sub(r'[\x00-\x1f<>]', '', str(value or '')).strip()[:limit]


def timestamp(value, zone):
    try:
        parsed = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
        if parsed.tzinfo is None:
            # Reject DST gaps and ambiguous wall times; require explicit offset.
            first, second = parsed.replace(tzinfo=zone, fold=0), parsed.replace(tzinfo=zone, fold=1)
            if first.utcoffset() != second.utcoffset() or first.astimezone(timezone.utc).astimezone(zone).replace(tzinfo=None) != parsed:
                raise ValueError()
            parsed = first
        return parsed.astimezone(timezone.utc)
    except (ValueError, TypeError):
        raise ValueError('Enter valid start/end dates with an explicit offset for ambiguous times.')


def validate_campaign(payload, current=None):
    current = current or {}
    merged = {**current, **payload}
    title = text(merged.get('title'), 120)
    kind = merged.get('type')
    if not title or kind not in TYPES:
        raise ValueError('Enter a campaign title and valid type.')
    custom = text(merged.get('customType'), 60)
    if kind == 'custom' and not custom:
        raise ValueError('Enter a custom type label.')
    zone_name = merged.get('timezone', 'Asia/Kolkata')
    try:
        zone = ZoneInfo(zone_name)
    except (ZoneInfoNotFoundError, TypeError):
        raise ValueError('Choose a valid time zone.')
    start, end = timestamp(merged.get('startsAt'), zone), timestamp(merged.get('endsAt'), zone)
    if end <= start:
        raise ValueError('End must be after start.')
    slug = current.get('slug') or text(merged.get('slug') or title, 100).lower()
    slug = re.sub(r'[^a-z0-9]+', '-', slug).strip('-')
    if not slug:
        raise ValueError('Enter a valid campaign slug.')
    publication = merged.get('publication', 'draft')
    if publication not in ('draft', 'published', 'paused', 'archived'):
        raise ValueError('Choose a valid publication state.')
    cta = text(merged.get('ctaDestination'), 200)
    if cta and (not cta.startswith('/') or cta.startswith('//') or '\\' in cta):
        raise ValueError('CTA must link to a storefront path.')
    runner = merged.get('showAnnouncementRunner', False)
    featured = merged.get('announcementFeatured', False)
    if not isinstance(runner, bool) or not isinstance(featured, bool):
        raise ValueError('Announcement settings must be boolean.')
    announcement_start = timestamp(merged['announcementStartsAt'], zone) if merged.get('announcementStartsAt') else None
    if runner and (not announcement_start or announcement_start > start):
        raise ValueError('Announcement start must be at or before the sale start.')
    return dict(title=title, type=kind, customType=custom, description=text(merged.get('description')),
                slug=slug, timezone=zone_name, startsAt=start, endsAt=end, publication=publication,
                bannerHeading=text(merged.get('bannerHeading'), 120), bannerSubtitle=text(merged.get('bannerSubtitle')),
                ctaLabel=text(merged.get('ctaLabel'), 60), ctaDestination=cta,
                showAnnouncementRunner=runner, announcementFeatured=featured, announcementStartsAt=announcement_start)


def view(campaign, now=None):
    result = {**json_value({k: v for k, v in campaign.items() if k not in ('_id', 'bannerData')}),
            'id': str(campaign['_id']), 'state': campaign_state(campaign, now),
            'bannerUrl': campaign.get('bannerMediaUrl') or campaign.get('bannerUrl') or (f"/api/sales/{campaign['_id']}/banner?v={campaign.get('bannerVersion', '')}" if campaign.get('bannerVersion') else None)}
    # Legacy campaigns are images; no migration is required.
    if campaign.get('bannerData') and not campaign.get('bannerMediaType'):
        result.update(bannerMediaType='image', bannerMimeType='image/jpeg', bannerMediaSource='upload')
    elif result.get('bannerUrl') and not campaign.get('bannerMediaType'):
        result.update(bannerMediaType='image', bannerMimeType=campaign.get('bannerMimeType') or 'image/jpeg')
    return result


def campaign_or_404(cid):
    return database().sale_campaigns.find_one({'_id': ObjectId(cid)}) if ObjectId.is_valid(cid) else None


@sales_bp.get('/manage')
@requirePermission('sales:manage')
def manage():
    db = database()
    rows = [view(c) for c in db.sale_campaigns.find({}, {'bannerData': 0}).sort('createdAt', -1)]
    published, sale_products, _ = public_inventory(db)
    visible_ids = {c['id'] for c in published}
    for row in rows:
        row['publiclyVisible'] = row['id'] in visible_ids
    summary = {'live': sum(c['state'] == 'live' for c in rows), 'scheduled': sum(c['state'] == 'scheduled' for c in rows), 'expired': sum(c['state'] == 'expired' for c in rows), 'products': len(sale_products)}
    return jsonify(campaigns=rows, summary=summary, serverTime=json_value(utcnow()), salePageEnabled=(db.admin_settings.find_one({'_id': 'store'}) or {}).get('salePageEnabled') is True)


@sales_bp.put('/visibility')
@requireAdmin
def visibility():
    value = (request.get_json(silent=True) or {}).get('enabled')
    if not isinstance(value, bool):
        return jsonify(error='Visibility must be boolean.'), 400
    database().admin_settings.update_one({'_id': 'store'}, {'$set': {'salePageEnabled': value}}, upsert=True)
    return jsonify(enabled=value)


@sales_bp.post('/manage')
@requirePermission('sales:manage')
def create():
    try:
        data = validate_campaign(request.get_json(silent=True) or {})
    except ValueError as e:
        return jsonify(error=str(e)), 400
    # Random suffix keeps simultaneous same-title creation safe without startup writes.
    campaign_id = ObjectId()
    data['slug'] += '-' + str(campaign_id)
    now = utcnow()
    data.update(_id=campaign_id, createdAt=now, updatedAt=now, createdBy=str(current_user()['_id']), createdByLabel=text(current_user().get('displayName') or current_user().get('firstName') or 'Staff', 120), revision=1, items=[])
    database().sale_campaigns.insert_one(data)
    return jsonify(campaign=view(data)), 201


@sales_bp.put('/manage/<cid>')
@requirePermission('sales:manage')
def update(cid):
    current = campaign_or_404(cid)
    if not current:
        return jsonify(error='Campaign not found.'), 404
    payload = request.get_json(silent=True) or {}
    if payload.get('revision') != current.get('revision'):
        return jsonify(error='Campaign changed. Reload before saving.'), 409
    try:
        data = validate_campaign(payload, current)
        if data['publication'] == 'published':
            assigned = payload.get('items', current.get('items') or [])
            if not assigned:
                raise ValueError('Add at least one eligible sale product before publishing.')
            for item in assigned:
                product_id = str(item.get('productId') or '')
                product = database().products.find_one({'_id': ObjectId(product_id)}) if ObjectId.is_valid(product_id) else None
                if not product or not eligible(product):
                    raise ValueError('Every sale assignment must reference an active product.')
                variants = [v for v in visible_variants(product) if eligible(product, v)]
                targeted = [v for v in variants if (not item.get('variantId') or str(v.get('id')) == str(item.get('variantId')))
                            and (not item.get('targetSkus') or any(t.get('variantId') == str(v.get('id')) and t.get('sku') == v.get('sku') for t in item['targetSkus']))]
                if product.get('variants') and not targeted:
                    raise ValueError('Every sale assignment must include an active, matching variant.')
                try:
                    bases = [((v.get('price') if v.get('priceMode') == 'override' else None) or product.get('price')) for v in targeted] if targeted else [product.get('price')]
                    for base in bases:
                        discounted(base, item.get('discountPercent'))
                except ValueError:
                    raise ValueError('Every sale assignment must have a valid MRP and discount.')
        if 'items' in payload and payload['items'] != current.get('items', []):
            if not isinstance(payload['items'], list) or len(payload['items']) > 500:
                raise ValueError('Choose at most 500 sale assignments.')
            items, seen = [], set()
            for row in payload['items']:
                if not isinstance(row, dict) or not ObjectId.is_valid(str(row.get('productId'))):
                    raise ValueError('Choose a valid product.')
                product = database().products.find_one({'_id': ObjectId(row['productId'])})
                if not product or not eligible(product):
                    raise ValueError('Only active products can be added.')
                variants = [v for v in visible_variants(product) if eligible(product, v)]
                if product.get('variants') and not variants:
                    raise ValueError('This product has no active sellable variants.')
                vid = str(row.get('variantId') or '')
                targets = [v for v in variants if str(v.get('id')) == vid] if vid else variants or [None]
                if not targets:
                    raise ValueError('Choose an active colour/SKU.')
                if any((row['productId'], str(v.get('id')) if v else '') in seen for v in targets):
                    raise ValueError('This product/variant is already assigned.')
                for variant in targets:
                    money((variant or {}).get('price') if (variant or {}).get('price') is not None else product.get('price'))
                    discounted((variant or {}).get('price') if (variant or {}).get('price') is not None else product.get('price'), row.get('discountPercent'))
                    seen.add((row['productId'], str(variant.get('id')) if variant else ''))
                # Product-wide targeting is explicit and keeps every variant's own MRP.
                previous = next((i for i in current.get('items', []) if i['productId'] == row['productId'] and i.get('variantId', '') == vid), None)
                items.append({'id': previous['id'] if previous else secrets.token_hex(12), 'productId': row['productId'],
                              'variantId': vid, 'targetSkus': [{'variantId':str(v['id']), 'sku':v['sku']} for v in targets if v],
                              'discountPercent': float(row['discountPercent'])})
            data['items'] = items
    except (ValueError, TypeError) as e:
        return jsonify(error=str(e)), 400
    now = utcnow()
    data.update(updatedAt=now, updatedBy=str(current_user()['_id']))
    saved = database().sale_campaigns.find_one_and_update({'_id': current['_id'], 'revision': current['revision']},
        {'$set': data, '$inc': {'revision': 1}, '$push': {'audit': {'at': now, 'by': data['updatedBy'], 'action': 'updated', 'publication': data['publication']}}}, return_document=ReturnDocument.AFTER)
    if not saved:
        return jsonify(error='Campaign changed. Reload before saving.'), 409
    return jsonify(campaign=view(saved))


@sales_bp.get('/products')
@requirePermission('sales:manage')
def selection():
    from .catalog import product_card_view, is_excluded_collection, collection_product_documents
    db = database()
    collections = [c for c in db.collections.find({}) if not is_excluded_collection(c) and c.get('status') != 'archived' and c.get('isActive') is not False]
    selected_collection_id = str(request.args.get('collection') or '').strip()
    selected_collection = next((c for c in collections if str(c.get('_id')) == selected_collection_id), None) if selected_collection_id else None
    if selected_collection_id and selected_collection is None:
        return jsonify(error='Collection not found or unavailable.', products=[], collections=[]), 404

    # Collection.productRefs is the canonical relationship. Reuse the catalogue
    # resolver so legacy reference normalization and ordering match storefronts.
    if selected_collection:
        candidates = [product for product, _order in collection_product_documents(db, selected_collection)]
    else:
        candidates = list(db.products.find({}))
    membership_by_product = {}
    for collection_doc in collections:
        for product_doc, _order in collection_product_documents(db, collection_doc):
            membership_by_product.setdefault(str(product_doc['_id']), set()).add(str(collection_doc['_id']))

    query = str(request.args.get('q') or '').strip().casefold()
    query_terms = [term for term in query.split() if term]
    products, excluded, seen = [], [], set()
    total_count = 0
    eligible_count = 0
    for product in candidates:
        product_id = str(product.get('_id') or '')
        if not product_id or product_id in seen:
            continue
        seen.add(product_id)
        total_count += 1
        reasons = []
        if product.get('status') == 'archived':
            reasons.append('Archived')
        elif product.get('status') != 'active' or product.get('isActive') is False:
            reasons.append('Inactive: product must be Active before sale assignment')
        selectable = [v for v in visible_variants(product) if eligible(product, v)]
        if product.get('variants') and not selectable and not reasons:
            reasons.append('No eligible variant')
        try:
            for variant in selectable or [None]:
                base = variant.get('price') if variant and variant.get('priceMode') == 'override' else product.get('price')
                money(base)
        except ValueError:
            reasons.append('No valid MRP')
        if not reasons:
            eligible_count += 1
        memberships = [dict(id=str(c['_id']), name=c.get('name') or '') for c in collections if str(c['_id']) in membership_by_product.get(product_id, set())]
        if selected_collection and str(selected_collection['_id']) not in membership_by_product.get(product_id, set()):
            continue
        attributes = product.get('attributes') if isinstance(product.get('attributes'), dict) else {}
        search_values = [product.get(key) for key in ('name', 'styleCode', 'style', 'productCode', 'sku', 'shortDescription', 'skuPrefix')]
        search_values.extend(attributes.get(key) for key in ('color', 'colors', 'colour', 'colours', 'fabric', 'material', 'occasion'))
        for variant in visible_variants(product):
            search_values.extend(variant.get(key) for key in ('sku', 'name', 'colour', 'color', 'colourSlug', 'styleCode'))
        searchable = ' '.join(str(value) for value in search_values if value is not None).casefold()
        if query_terms and not all(term in searchable for term in query_terms):
            continue
        if reasons:
            excluded.append(dict(id=product_id, name=product.get('name') or '', productCode=product.get('productCode') or product.get('sku') or '', reasons=reasons, adminUrl=next((f"/admin/products/{c['slug']}?productId={product_id}" for c in collections if str(c['_id']) in membership_by_product.get(product_id,set()) and c.get('slug')), None)))
            continue
        # Admin picker must always show base MRP, even though this is the sales blueprint.
        result = product_card_view(product)
        for v in result.get('variants', []):
            v['price'] = (v.get('sale') or {}).get('mrp', v.get('price'))
        result['price'] = (result.get('sale') or {}).get('mrp', result.get('price'))
        result['collections'] = memberships
        products.append(result)
    return jsonify(products=products, collections=[dict(id=str(c['_id']), name=c.get('name') or '') for c in collections], count=len(products), totalCount=total_count, eligibleCount=eligible_count, excludedProducts=excluded)


def public_inventory(db, slug=None, now=None):
    from .catalog import product_card_view
    now = now or utcnow()
    campaigns = active_campaigns(db, now)
    if slug:
        campaigns = [c for c in campaigns if c['slug'] == slug]
    output, valid = {}, []
    for campaign in campaigns:
        count = 0
        for item in campaign.get('items', []):
            product = db.products.find_one({'_id': ObjectId(item['productId'])})
            if not product or not eligible(product):
                continue
            targets = [v for v in visible_variants(product) if v.get('status') == 'active' and (not item.get('variantId') or str(v.get('id')) == item['variantId'])]
            if not targets and product.get('variants'):
                continue
            target_prices = [effective_catalog_price(db, product, v, now, campaigns=[campaign]) for v in targets or [None]]
            if not any(p['isOnSale'] for p in target_prices):
                continue
            card = product_card_view(product)
            # Only sale-eligible variants appear on the sale landing page.
            card['variants'] = [v for v in card['variants'] if (v.get('sale') or {}).get('isOnSale')]
            first = card['variants'][0] if card['variants'] else None
            if first:
                card.update(price=first['price'], sale=first['sale'])
            card['collections'] = [dict(id=str(c['_id']), name=c['name'], slug=c['slug']) for c in db.collections.find({'productRefs.productId': product['_id']}, {'name': 1, 'slug': 1})]
            output[card['id']] = card
            count += 1
        if count:
            visible = view(campaign, now)
            valid.append({key: visible.get(key) for key in ('id', 'title', 'slug', 'description', 'startsAt', 'endsAt', 'timezone', 'bannerUrl', 'bannerMediaType', 'bannerPosterUrl', 'bannerHeading', 'bannerSubtitle', 'ctaLabel', 'ctaDestination')})
    return valid, list(output.values()), now


@sales_bp.get('/public')
def public():
    campaigns, products, now = public_inventory(database(), request.args.get('campaign'))
    if not campaigns:
        return jsonify(available=False, campaigns=[], products=[], serverTime=json_value(now)), 404
    return jsonify(available=True, campaigns=campaigns, products=products, serverTime=json_value(now))


@sales_bp.get('/announcement')
def announcement():
    from .sale_announcements import public_announcement
    return jsonify(public_announcement(database(), utcnow()))


@sales_bp.post('/manage/announcement-preview')
@requirePermission('sales:manage')
def announcement_preview():
    from .sale_announcements import announcement_message
    try:
        campaign = validate_campaign(request.get_json(silent=True) or {})
    except ValueError as error:
        return jsonify(error=str(error)), 400
    now = utcnow()
    message = f"{campaign['title']} · ENDED" if now >= campaign['endsAt'] else announcement_message(campaign, now)
    return jsonify(message=message, serverTime=json_value(now),
                   visible=bool(campaign['showAnnouncementRunner'] and campaign['announcementStartsAt'] <= now < campaign['endsAt']))


@sales_bp.get('/teaser/<slug>')
def teaser(slug):
    from .sale_announcements import prelaunch_eligible, safe_campaign, valid_schedule
    db, now = database(), utcnow()
    campaign = db.sale_campaigns.find_one({'slug': slug})
    enabled = (db.admin_settings.find_one({'_id': 'store'}) or {}).get('salePageEnabled') is True
    if not enabled or not campaign or not valid_schedule(campaign, now) or not campaign.get('showAnnouncementRunner'):
        return jsonify(error='Campaign not found.'), 404
    if now >= aware(campaign['startsAt']):
        live, _, _ = public_inventory(db, slug, now)
        return (jsonify(redirect='/sale', serverTime=json_value(now)), 200) if live else (jsonify(error='Campaign not found.'), 404)
    if not prelaunch_eligible(campaign, now):
        return jsonify(error='Campaign not found.'), 404
    return jsonify(campaign=safe_campaign(campaign, now), serverTime=json_value(now))


@sales_bp.post('/manage/<cid>/banner')
@requirePermission('sales:manage')
def banner_upload(cid):
    campaign = campaign_or_404(cid)
    if not campaign:
        return jsonify(error='Campaign not found.'), 404
    revision = (request.get_json(silent=True) or {}).get('revision') if request.is_json else request.form.get('revision')
    if str(revision) != str(campaign['revision']):
        return jsonify(error='Campaign changed. Reload before replacing its banner.'), 409
    from .campaign_media import CampaignMediaError, inspect_uploaded_media, verify_external_url
    payload = request.get_json(silent=True) or {} if request.is_json else {}
    stored_id, media, image_data = None, None, None
    try:
        if request.is_json:
            link = str(payload.get('mediaUrl') or payload.get('workdriveLink') or '').strip()
            from .workdrive import (WorkDriveFileNotFound, WorkDriveUnavailable,
                                    download_file, is_supported_permalink)
            if is_supported_permalink(link):
                download = download_file(link, database(), prefer_preview=False)
                try:
                    response = download.response
                    mime = (response.headers.get('Content-Type') or '').split(';', 1)[0].lower()
                    limit = MAX_VIDEO if mime.startswith('video/') else MAX_IMAGE
                    chunks, length = [], 0
                    for chunk in response.iter_content(65536):
                        if not chunk: continue
                        length += len(chunk)
                        if length > limit: raise CampaignMediaError('This WorkDrive media exceeds its configured size limit.')
                        chunks.append(chunk)
                    data = b''.join(chunks)
                    extension = sorted(SUPPORTED[mime][1])[0]
                    media = inspect_uploaded_media(data, mime, f'workdrive.{extension}')
                    media.update(source='workdrive', fileIdentity=download.file_id, filename=None)
                    if media['mediaType'] == 'image':
                        image_data = _normalise_sale_image(data)
                    else:
                        stored_id = _save_sale_gridfs(database(), data, media)
                finally:
                    download.response.close()
            else:
                media = verify_external_url(link)
                media.update(source='external', filename=None)
                media['url'] = media.pop('url')
        else:
            request.max_content_length = MAX_VIDEO + 1024 * 1024
            file = request.files.get('file')
            if not file or not file.filename:
                raise CampaignMediaError('Choose an image or video file.')
            data = file.read(MAX_VIDEO + 1)
            media = inspect_uploaded_media(data, file.mimetype, file.filename)
            media.update(source='upload', filename=str(file.filename)[:180])
            if media['mediaType'] == 'image': image_data = _normalise_sale_image(data)
            else: stored_id = _save_sale_gridfs(database(), data, media)
    except CampaignMediaError as error:
        return jsonify(error=str(error)), 400
    except WorkDriveFileNotFound:
        return jsonify(error='The WorkDrive file was not found or its share has expired.'), 422
    except WorkDriveUnavailable as error:
        # Provider exceptions contain safe, user-facing categories; never serialize tokens or URLs.
        return jsonify(error=str(error)), 422
    except (ValueError, UnidentifiedImageError, OSError, Image.DecompressionBombError) as error:
        return jsonify(error=f'Unable to verify campaign media: {error}'), 400
    except Exception:
        return jsonify(error='Campaign media could not be verified. Check the public URL or WorkDrive access.'), 422
    if not media:
        return jsonify(error='Choose a supported campaign image or video.'), 400
    # Optional posters must independently verify as public image media.
    poster_url = None
    poster_candidate = payload.get('posterUrl') if request.is_json else request.form.get('posterUrl')
    if poster_candidate:
        try:
            poster = verify_external_url(str(poster_candidate))
            if poster['mediaType'] != 'image': raise CampaignMediaError('Poster must be a supported image.')
            poster_url = poster['url']
        except CampaignMediaError as error:
            if stored_id: GridFSBucket(database(), bucket_name='sale_banner_media').delete(stored_id)
            return jsonify(error=f'Invalid poster: {error}'), 400
    now, actor = utcnow(), str(current_user()['_id'])
    new_url = (media.get('url') if media['source'] == 'external' else
               f"/api/sales/{campaign['_id']}/banner-media?v={secrets.token_hex(8)}" if media['mediaType'] == 'video' else
               f"/api/sales/{campaign['_id']}/banner?v={secrets.token_hex(8)}")
    set_fields = {'bannerMediaType': media['mediaType'], 'bannerMediaUrl': new_url,
                  'bannerMediaSource': media['source'], 'bannerMimeType': media['mimeType'],
                  'bannerOriginalFilename': media.get('filename'), 'bannerPosterUrl': poster_url,
                  'bannerAltText': text(payload.get('altText'), 180) if request.is_json else text(request.form.get('altText'), 180),
                  'bannerMediaSize': media.get('size'), 'bannerSourceHost': media.get('sourceHost'),
                  'bannerWorkDriveFileId': media.get('fileIdentity'),
                  'bannerVersion': secrets.token_hex(8), 'updatedAt': now, 'updatedBy': actor}
    if image_data is not None: set_fields['bannerData'] = image_data
    if stored_id: set_fields['bannerMediaId'] = stored_id
    unset_fields = {}
    if image_data is None: unset_fields['bannerData'] = ''
    if stored_id is None: unset_fields['bannerMediaId'] = ''
    mutation = {'$set': set_fields, '$inc': {'revision': 1},
                '$push': {'audit': {'at': now, 'by': actor, 'action': 'banner_replaced'}}}
    if unset_fields: mutation['$unset'] = unset_fields
    saved = database().sale_campaigns.find_one_and_update(
        {'_id': campaign['_id'], 'revision': campaign['revision']}, mutation, return_document=ReturnDocument.AFTER)
    if not saved:
        if stored_id: GridFSBucket(database(), bucket_name='sale_banner_media').delete(stored_id)
        return jsonify(error='Campaign changed. Reload before replacing its banner.'), 409
    if campaign.get('bannerMediaId') and campaign.get('bannerMediaId') != stored_id:
        try: GridFSBucket(database(), bucket_name='sale_banner_media').delete(campaign['bannerMediaId'])
        except Exception: pass
    return jsonify(campaign=view(saved))


def _normalise_sale_image(data):
    image = Image.open(BytesIO(data))
    if image.format not in ('JPEG', 'PNG', 'WEBP') or image.width * image.height > 30_000_000:
        raise CampaignMediaError('Choose a supported banner image up to 30 megapixels.')
    image.load(); image.thumbnail((2400, 1600))
    output = BytesIO(); image.convert('RGB').save(output, format='JPEG', quality=88)
    return output.getvalue()


def _save_sale_gridfs(db, data, metadata):
    bucket = GridFSBucket(db, bucket_name='sale_banner_media')
    file_id = bucket.upload_from_stream(metadata.get('filename') or 'sale-banner', data,
        metadata={key: metadata.get(key) for key in ('mediaType', 'mimeType', 'source', 'extension', 'size', 'fileIdentity')})
    return file_id


@sales_bp.delete('/manage/<cid>/banner')
@requirePermission('sales:manage')
def banner_remove(cid):
    campaign = campaign_or_404(cid)
    if not campaign:
        return jsonify(error='Campaign not found.'), 404
    if (request.get_json(silent=True) or {}).get('revision') != campaign['revision']:
        return jsonify(error='Campaign changed. Reload before removing its banner.'), 409
    now, actor = utcnow(), str(current_user()['_id'])
    saved = database().sale_campaigns.find_one_and_update({'_id': campaign['_id'], 'revision': campaign['revision']},
        {'$unset': {'bannerData': '', 'bannerVersion': '', 'bannerMediaType': '', 'bannerMediaUrl': '', 'bannerMediaSource': '', 'bannerMimeType': '', 'bannerOriginalFilename': '', 'bannerPosterUrl': '', 'bannerMediaSize': '', 'bannerSourceHost': '', 'bannerWorkDriveFileId': '', 'bannerMediaId': ''}, '$inc': {'revision': 1}, '$set': {'updatedAt': now, 'updatedBy': actor},
         '$push': {'audit': {'at': now, 'by': actor, 'action': 'banner_removed'}}}, return_document=ReturnDocument.AFTER)
    if not saved:
        return jsonify(error='Campaign changed. Reload before removing its banner.'), 409
    if campaign.get('bannerMediaId'):
        try: GridFSBucket(database(), bucket_name='sale_banner_media').delete(campaign['bannerMediaId'])
        except Exception: pass
    return jsonify(campaign=view(saved))


@sales_bp.get('/<cid>/banner')
def banner_image(cid):
    campaign = campaign_or_404(cid)
    if not campaign or not campaign.get('bannerData'):
        return jsonify(error='Banner not found.'), 404
    # Public visibility follows the same live eligibility as the landing page.
    campaigns, _, _ = public_inventory(database())
    if not any(c['id'] == cid for c in campaigns):
        from .sale_announcements import prelaunch_eligible
        enabled = (database().admin_settings.find_one({'_id': 'store'}) or {}).get('salePageEnabled') is True
        if not enabled or not prelaunch_eligible(campaign, utcnow()):
            return jsonify(error='Banner not found.'), 404
    return Response(bytes(campaign['bannerData']), mimetype='image/jpeg', headers={'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'})


@sales_bp.get('/manage/<cid>/banner')
@requirePermission('sales:manage')
def preview_banner(cid):
    campaign = campaign_or_404(cid)
    if not campaign or not campaign.get('bannerData'):
        return jsonify(error='Banner not found.'), 404
    return Response(bytes(campaign['bannerData']), mimetype='image/jpeg', headers={'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'})


def _stream_campaign_media(cid, admin=False):
    campaign = campaign_or_404(cid)
    if not campaign or not campaign.get('bannerMediaId'):
        return jsonify(error='Banner media not found.'), 404
    if not admin:
        campaigns, _, _ = public_inventory(database())
        if not any(row['id'] == cid for row in campaigns):
            from .sale_announcements import prelaunch_eligible
            enabled = (database().admin_settings.find_one({'_id': 'store'}) or {}).get('salePageEnabled') is True
            if not enabled or not prelaunch_eligible(campaign, utcnow()): return jsonify(error='Banner not found.'), 404
    try: stream = GridFSBucket(database(), bucket_name='sale_banner_media').open_download_stream(campaign['bannerMediaId'])
    except Exception: return jsonify(error='Banner media not found.'), 404
    size, start, end, status = stream.length, 0, stream.length - 1, 200
    range_header = request.headers.get('Range', '')
    if range_header.startswith('bytes=') and ',' not in range_header:
        try:
            left, right = range_header[6:].split('-', 1)
            if left:
                start = int(left); end = min(int(right), size - 1) if right else size - 1
            elif right:
                start = max(0, size - int(right)); end = size - 1
            if start > end or start >= size: raise ValueError()
            stream.seek(start); status = 206
        except ValueError:
            stream.close(); return Response(status=416, headers={'Content-Range': f'bytes */{size}'})
    length = end - start + 1
    def body():
        remaining = length
        try:
            while remaining:
                block = stream.read(min(64 * 1024, remaining))
                if not block: break
                remaining -= len(block); yield block
        finally: stream.close()
    headers = {'Content-Length': str(length), 'Accept-Ranges': 'bytes', 'Cache-Control': 'public, max-age=300', 'X-Content-Type-Options': 'nosniff'}
    if status == 206: headers['Content-Range'] = f'bytes {start}-{end}/{size}'
    return Response(stream_with_context(body()), status=status, mimetype=campaign.get('bannerMimeType') or 'application/octet-stream', headers=headers)


@sales_bp.get('/<cid>/banner-media')
def banner_media(cid):
    return _stream_campaign_media(cid, admin=False)


@sales_bp.get('/manage/<cid>/banner-media')
@requirePermission('sales:manage')
def preview_banner_media(cid):
    return _stream_campaign_media(cid, admin=True)


@sales_bp.post('/prices')
def prices():
    body = request.get_json(silent=True) or {}
    rows = body.get('items')
    if not isinstance(rows, list) or len(rows) > 50:
        return jsonify(error='Choose at most 50 items.'), 400
    db, result = database(), []
    now = utcnow()
    campaigns = active_campaigns(db, now)
    for row in rows:
        if not isinstance(row, dict) or not ObjectId.is_valid(str(row.get('productId'))):
            continue
        product = db.products.find_one({'_id': ObjectId(row['productId'])})
        variant = next((v for v in visible_variants(product or {}) if str(v.get('id')) == row.get('variantId') and v.get('status') == 'active'), None)
        if product and eligible(product) and variant:
            value = effective_catalog_price(db, product, variant, now, campaigns)
            result.append(dict(productId=row['productId'], variantId=row.get('variantId'), price=value['effectivePrice'], sale=value))
    return jsonify(prices=result, serverTime=json_value(now))
