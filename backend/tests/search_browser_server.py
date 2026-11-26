"""Opt-in synthetic catalogue using the actual Flask search routes; no .env or providers."""
import os
if os.environ.get('RK_SEARCH_BROWSER_FIXTURE') != '1':
    raise SystemExit('Synthetic search fixture requires explicit opt-in.')
os.environ['RK_SALE_BROWSER_FIXTURE'] = '1'
import sys
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
patch('dotenv.load_dotenv', return_value=False).start()
patch('dotenv.dotenv_values', return_value={}).start()
from app.catalog import ensure_catalog_seed as actual_catalog_seed
from sale_browser_server import app, db, reset
from bson import ObjectId
from flask import jsonify
# Restore only the real seed compatibility function; all database and provider boundaries stay mocked.
patch('app.catalog.ensure_catalog_seed', actual_catalog_seed).start()
patch('app.blueprints.staff.routes.ensure_catalog_seed', actual_catalog_seed).start()


@app.post('/__fixture/search')
def search_fixture():
    reset()
    db.products.delete_many({})
    db.collections.delete_many({})
    rows = []
    for index, name in enumerate(['Jaal Embroidered Lehenga', 'Jaal Work Anarkali', 'Ivory Jaal Saree', 'Jaal Silk Set', 'Jaal Occasion Edit']):
        rows.append({'_id': ObjectId(f'{index+50:024x}'), 'name': name, 'productCode': 'CK213' if index == 0 else f'CK{index}', 'sku': f'PARENT-{index}',
                     'status': 'active', 'price': 1000, 'attributes': {'fabric': 'Silk'},
                     'variants': [{'id': 'colour:royal-blue', 'sku': 'AA-CK213-ROYAL-BLUE' if index == 0 else f'AA-CK{index}-BLUE', 'colour': 'ROYAL BLUE', 'status': 'active', 'images': []}]})
    db.products.insert_many(rows)
    db.collections.insert_one({'name': 'Aakaar', 'slug': 'aakaar', 'status': 'active', 'productRefs': [{'productId': row['_id']} for row in rows]})
    return jsonify(ok=True)


@app.post('/__fixture/collection-name')
def collection_name_fixture():
    token_response = reset()
    db.products.delete_many({})
    db.collections.delete_many({})
    product_id = ObjectId('000000000000000000000032')
    db.products.insert_one({'_id': product_id, 'name': 'CK213', 'productCode': 'CK213', 'sku': 'AA-CK213-ROYAL-BLUE', 'status': 'active', 'price': 1000,
                            'stock': 0, 'variants': [], 'media': []})
    db.collections.insert_one({'_id': ObjectId('000000000000000000000033'), 'name': 'AAKAAR', 'slug': 'aakaar', 'status': 'collection', 'collectionType': 'standard',
                               'productRefs': [{'productId': product_id, 'displayOrder': 1}], 'hero': {'type': 'image', 'image': '/synthetic-search.svg'},
                               'coverImage': '/synthetic-search.svg', 'description': 'Synthetic saved collection'})
    db.collections.insert_one({'name': 'Archive EDIT', 'slug': 'archive-edit', 'status': 'collection', 'productRefs': []})
    return token_response


if __name__ == '__main__':
    app.run(host='127.0.0.1', port=5166, use_reloader=False)
