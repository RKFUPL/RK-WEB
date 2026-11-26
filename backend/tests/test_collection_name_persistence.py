from copy import deepcopy
from unittest.mock import patch

import mongomock
import pytest
from bson import ObjectId
from flask import Flask
from flask_jwt_extended import JWTManager, create_access_token

from app.catalog import ensure_catalog_seed
from app.blueprints.staff.routes import staff_bp
from app.blueprints.catalog.routes import catalog_bp


@pytest.fixture
def collection_shop():
    db = mongomock.MongoClient().synthetic_collection_names
    identity, product_id, user_id = ObjectId(), ObjectId(), ObjectId()
    db.products.insert_one({'_id': product_id, 'name': 'CK213', 'productCode': 'CK213', 'sku': 'AA-CK213', 'status': 'active', 'price': 1000, 'stock': 0, 'variants': []})
    db.collections.insert_one({'_id': identity, 'name': 'AAKAAR', 'slug': 'aakaar', 'status': 'collection', 'collectionType': 'standard',
                               'productRefs': [{'productId': product_id, 'displayOrder': 1}], 'coverImage': '/synthetic.jpg',
                               'hero': {'type': 'image', 'image': '/synthetic-banner.jpg'}, 'description': 'Saved description'})
    user = {'_id': user_id, 'role': 'admin', 'isActive': True}
    app = Flask(__name__)
    app.config.update(TESTING=True, JWT_SECRET_KEY='synthetic-collection-name-signing-key-only')
    JWTManager(app)
    app.register_blueprint(staff_bp, url_prefix='/api/staff')
    app.register_blueprint(catalog_bp, url_prefix='/api/catalog')
    with app.app_context():
        token = create_access_token(identity=str(user_id))
    with patch('app.rbac.database', return_value=db), patch('app.rbac.current_user', return_value=user), \
         patch('app.blueprints.staff.routes.database', return_value=db), patch('app.blueprints.staff.routes.current_user', return_value=user), \
         patch('app.blueprints.catalog.routes.database', return_value=db):
        yield db, app.test_client(), {'Authorization': f'Bearer {token}'}, identity, product_id


@pytest.mark.parametrize('name', ['Aakaar', 'Sculpted EDIT', 'aakaar', 'Hastakala'])
def test_normal_patch_response_readback_and_repeated_seed_preserve_saved_name(collection_shop, name):
    db, client, headers, identity, product_id = collection_shop
    before = deepcopy(db.collections.find_one({'_id': identity}))
    response = client.patch('/api/staff/collections/aakaar', headers=headers, json={'name': name})
    assert response.status_code == 200
    assert response.json['collection']['name'] == name
    # Building the response itself calls managed_collections -> ensure_catalog_seed.
    assert db.collections.find_one({'_id': identity})['name'] == name
    for _ in range(2):
        ensure_catalog_seed(db)
        readback = client.get('/api/staff/collections/aakaar', headers=headers)
        assert readback.status_code == 200
        assert readback.json['collection']['name'] == name
        assert next(c for c in readback.json['allCollections'] if c['id'] == str(identity))['name'] == name
    persisted = db.collections.find_one({'_id': identity})
    for field in ('_id', 'slug', 'productRefs', 'coverImage', 'hero', 'description'):
        assert persisted[field] == before[field]
    public = client.get('/api/catalog/collections').json['collections']
    assert next(row for row in public if row['id'] == str(identity))['name'] == name
    search = client.get('/api/catalog/products?q=CK213').json['products'][0]
    assert next(c for c in search['collections'] if c['id'] == str(identity))['name'] == name
    assert search['productCode'] == 'CK213'
    assert db.products.find_one({'_id': product_id})['sku'] == 'AA-CK213'


def test_existing_legacy_name_is_not_silently_rewritten(collection_shop):
    db, _, _, identity, _ = collection_shop
    ensure_catalog_seed(db)
    assert db.collections.find_one({'_id': identity})['name'] == 'AAKAAR'


def test_patch_exact_identity_and_counts(collection_shop):
    db, client, headers, identity, _ = collection_shop
    original = db.collections.update_one
    observed = []
    def record(selector, update, *args, **kwargs):
        result = original(selector, update, *args, **kwargs)
        if update.get('$set', {}).get('name') == 'Aakaar':
            observed.append((selector['_id'], result.matched_count, result.modified_count, db.collections.find_one({'_id': identity})['name']))
        return result
    with patch.object(db.collections, 'update_one', side_effect=record):
        response = client.patch('/api/staff/collections/aakaar', headers=headers, json={'name': 'Aakaar'})
    assert response.status_code == 200
    assert observed == [(identity, 1, 1, 'Aakaar')]


def test_zero_match_and_missing_never_succeed(collection_shop):
    from pymongo.results import UpdateResult
    db, client, headers, identity, _ = collection_shop
    ensure_catalog_seed(db)
    with patch.object(db.collections, 'update_one', return_value=UpdateResult({'n': 0, 'nModified': 0}, True)):
        response = client.patch('/api/staff/collections/aakaar', headers=headers, json={'name': 'Aakaar'})
    assert response.status_code == 409
    assert db.collections.find_one({'_id': identity})['name'] == 'AAKAAR'
    assert client.patch('/api/staff/collections/not-present', headers=headers, json={'name': 'Missing'}).status_code == 404


def test_stale_revision_cannot_overwrite_newer_name(collection_shop):
    db, client, headers, identity, _ = collection_shop
    old = client.get('/api/staff/collections/aakaar', headers=headers).json['collection']['updatedAt']
    assert client.patch('/api/staff/collections/aakaar', headers=headers, json={'name': 'Newer EDIT'}).status_code == 200
    response = client.patch('/api/staff/collections/aakaar', headers=headers, json={'name': 'Stale', 'expectedUpdatedAt': old})
    assert response.status_code == 409
    assert db.collections.find_one({'_id': identity})['name'] == 'Newer EDIT'


def test_concurrent_update_is_fenced(collection_shop):
    from datetime import datetime, timezone, timedelta
    db, client, headers, identity, _ = collection_shop
    ensure_catalog_seed(db)
    original = db.collections.update_one
    def competing(selector, update, *args, **kwargs):
        if update.get('$set', {}).get('name') == 'Aakaar':
            original({'_id': identity}, {'$set': {'name': 'Concurrent EDIT', 'updatedAt': datetime.now(timezone.utc) + timedelta(seconds=1)}})
        return original(selector, update, *args, **kwargs)
    with patch.object(db.collections, 'update_one', side_effect=competing):
        response = client.patch('/api/staff/collections/aakaar', headers=headers, json={'name': 'Aakaar'})
    assert response.status_code == 409
    assert db.collections.find_one({'_id': identity})['name'] == 'Concurrent EDIT'


def test_response_cannot_hide_reversion(collection_shop):
    from app.blueprints.staff.routes import _management_collection_payload
    db, client, headers, identity, _ = collection_shop
    def reverting(database, collection):
        response = _management_collection_payload(database, collection)
        database.collections.update_one({'_id': identity}, {'$set': {'name': 'AAKAAR'}})
        return response
    with patch('app.blueprints.staff.routes._management_collection_payload', side_effect=reverting):
        response = client.patch('/api/staff/collections/aakaar', headers=headers, json={'name': 'Aakaar'})
    assert response.status_code == 409
    assert 'read-back' in response.json['error']
