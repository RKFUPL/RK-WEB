"""Explicit lifecycle and inventory allocation; no startup migrations or writes."""
from copy import deepcopy
from datetime import datetime, timezone
from hashlib import sha256
import json
import math
from bson import ObjectId


def inventory_revision(product):
    fields = ('stock', 'variants', 'sizeInventory', 'sizeInventoryConfigured',
              'inventoryAllocationMode', 'inventoryAllocationRevision', 'inventoryOperationMarkers', 'manualReservations')
    return sha256(json.dumps({k: product.get(k) for k in fields}, default=str, sort_keys=True).encode()).hexdigest()


def activation_errors(product):
    from .catalog import product_view
    errors = []
    if not str(product.get('name') or '').strip(): errors.append('Product name is required.')
    if not str(product.get('sku') or '').strip(): errors.append('Style code / SKU is required.')
    price = product.get('price')
    if isinstance(price, bool) or not isinstance(price, (int, float)) or not math.isfinite(price) or price <= 0:
        errors.append('A valid positive original MRP is required.')
    view = product_view(product)
    if not view.get('media') and not any(v.get('images') for v in view.get('variants', [])):
        errors.append('Add a valid product or colour gallery image before activation.')
    if product.get('variants') and not any(v.get('status') == 'active' and v.get('id') and v.get('sku') for v in product['variants']):
        errors.append('At least one active colour with a canonical SKU is required.')
    return errors


def configured_buckets(product):
    """Return saved variant identities and their configured sizes, without guessing stock."""
    variants = product.get('variants') or []
    if variants:
        return [dict(variantId=str(v.get('id') or ''), sku=str(v.get('sku') or ''),
                     colour=str(v.get('colour') or ''), sizes=[str(s['size']) for s in v.get('sizeInventory', []) if s.get('enabled', True)])
                for v in variants if v.get('status') != 'remove']
    sizes = [str(s['size']) for s in product.get('sizeInventory', []) if s.get('enabled', True)]
    if not sizes:
        sizes = [str(s).strip().upper() for s in (product.get('attributes') or {}).get('sizes', []) if str(s).strip()]
    return [dict(variantId='', sku=str(product.get('sku') or ''), colour='', sizes=sizes)] if sizes else []


def allocation_total(product):
    parent = int(product.get('stock') or 0)
    variants = product.get('variants') or []
    variant_total = sum(int(v.get('stock') or 0) for v in variants)
    if product.get('inventoryAllocationMode') == 'variant_size': return variant_total
    if variant_total and parent and variant_total != parent:
        raise ValueError('Aggregate and colour stock disagree. Investigate existing inventory before allocation.')
    return variant_total or parent


def prepare_allocation(product, payload):
    reason = str(payload.get('reason') or '').strip()[:240]
    if not reason: raise ValueError('Enter a reason for the inventory allocation.')
    groups = configured_buckets(product)
    if not groups or any(not g['sizes'] or not g['sku'] for g in groups):
        raise ValueError('Configure valid sizes and canonical SKUs before allocation.')
    expected = {(g['variantId'], g['sku'], s) for g in groups for s in g['sizes']}
    if len(expected) != sum(len(g['sizes']) for g in groups): raise ValueError('Duplicate size/SKU configuration requires investigation.')
    if len({(sku, size) for _variant, sku, size in expected}) != len(expected):
        raise ValueError('Duplicate SKU/size identities across colours require investigation.')
    rows = payload.get('buckets')
    if not isinstance(rows, list): raise ValueError('Supply every configured colour and size bucket.')
    quantities = {}
    for row in rows:
        if not isinstance(row, dict): raise ValueError('Invalid inventory bucket.')
        key = (row.get('variantId', ''), row.get('sku'), row.get('size'))
        qty = row.get('quantity')
        if key in quantities or key not in expected: raise ValueError('Duplicate or mismatched size/SKU bucket.')
        if isinstance(qty, bool) or not isinstance(qty, int) or qty < 0: raise ValueError('Quantities must be non-negative integers.')
        quantities[key] = qty
    if set(quantities) != expected: raise ValueError('Supply every configured colour and size bucket.')
    total = sum(quantities.values())
    if not product.get('inventoryAllocationMode') and total != allocation_total(product):
        raise ValueError(f'Allocate exactly {allocation_total(product)} existing units before enabling size inventory.')
    updates = dict(stock=total, unallocatedStock=0)
    if product.get('variants'):
        variants = deepcopy(product['variants'])
        for variant in variants:
            if variant.get('status') == 'remove':
                if int(variant.get('stock') or 0): raise ValueError('Removed colour has stock; investigate before allocation.')
                continue
            for size in variant.get('sizeInventory', []):
                if size.get('enabled', True): size['stock'] = quantities[(variant['id'], variant['sku'], size['size'])]
                elif int(size.get('stock') or 0): raise ValueError('Disabled size has stock; investigate before allocation.')
            variant['stock'] = sum(int(s.get('stock') or 0) for s in variant.get('sizeInventory', []))
        updates.update(variants=variants, inventoryAllocationMode='variant_size', sizeInventoryConfigured=False, sizeSystemEnabled=False, sizeInventory=[])
    else:
        updates.update(sizeInventory=[dict(size=s, stock=quantities[('', groups[0]['sku'], s)], enabled=True) for s in groups[0]['sizes']],
                       inventoryAllocationMode='size', sizeInventoryConfigured=True, sizeSystemEnabled=True)
    return updates, reason


def save_allocation(db, product, payload, actor):
    if db.orders.find_one({'items.productId': str(product['_id']), '$or': [
            {'captureFulfillmentStatus': {'$in': ['held', 'processing']}},
            {'inventoryReservation': {'$in': ['reserving', 'unresolved']}}]}, {'_id': 1}):
        raise RuntimeError('An order has unresolved inventory for this product. Complete its inventory investigation before allocation.')
    if payload.get('inventoryRevision') != inventory_revision(product):
        raise RuntimeError('Inventory changed. Reload before allocating stock.')
    updates, reason = prepare_allocation(product, payload)
    now = datetime.now(timezone.utc)
    audit = dict(id=str(ObjectId()), reason=reason, createdAt=now, createdBy=actor['_id'],
                 before={k:deepcopy(product.get(k)) for k in updates}, after=deepcopy(updates), changeType='size_allocation')
    query = {'_id':product['_id']}
    for key in ('stock','variants','sizeInventory','sizeInventoryConfigured','inventoryAllocationMode','inventoryAllocationRevision','inventoryOperationMarkers','manualReservations'):
        query[key] = product[key] if key in product else {'$exists':False}
    result = db.products.update_one(query, {'$set':{**updates,'updatedAt':now}, '$inc':{'inventoryAllocationRevision':1}, '$push':{'inventoryAllocationHistory':audit}})
    if result.modified_count != 1: raise RuntimeError('Inventory changed concurrently. Reload before allocating stock.')
    # The authoritative audit is atomic with stock in the product document.
    return db.products.find_one({'_id':product['_id']})
