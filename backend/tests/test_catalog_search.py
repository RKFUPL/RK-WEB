from unittest.mock import patch

import mongomock
import pytest
from bson import ObjectId
from flask import Flask

from app.blueprints.catalog.routes import catalog_bp
from app.catalog_search import matching_variant, matches_product, relevance


@pytest.fixture
def search_shop():
    db = mongomock.MongoClient().synthetic_search
    first, second, third = [ObjectId() for _ in range(3)]
    db.products.insert_many([
        {'_id': first, 'name': 'Jaal Embroidered Lehenga', 'productCode': 'CK213', 'styleCode': 'STYLE-213', 'sku': 'AA-CK213', 'price': 1000,
         'status': 'active', 'attributes': {'fabric': 'Silk', 'material': 'Net'}, 'description': 'Hand finished couture', 'keywords': ['heirloom'],
         'variants': [{'id': 'colour:royal-blue', 'sku': 'AA-CK213-ROYAL-BLUE', 'colour': 'ROYAL BLUE', 'status': 'active', 'images': []}]},
        {'_id': second, 'name': 'Jaal Work Anarkali', 'sku': 'HK-CK99', 'price': 2000, 'status': 'active', 'description': 'Inspired by AA-CK213-ROYAL-BLUE', 'variants': []},
        {'_id': third, 'name': 'Evening Saree', 'sku': 'CK55', 'price': 3000, 'status': 'active', 'description': 'Jaal embroidery and Áakār detail', 'variants': []},
        {'name': 'Jaal hidden', 'status': 'active', 'isActive': False},
        {'name': 'Jaal archived', 'status': 'archived'},
    ])
    for name, slug, ids in [('AAKAAR', 'aakaar', [first]), ('Hastakala', 'collections-of-hastakala', [second, first])]:
        db.collections.insert_one({'name': name, 'slug': slug, 'status': 'active', 'productRefs': [{'productId': identity} for identity in ids]})
    app = Flask(__name__)
    app.register_blueprint(catalog_bp, url_prefix='/api/catalog')
    with patch('app.blueprints.catalog.routes.database', return_value=db):
        yield db, app.test_client(), str(first), str(second), str(third)


@pytest.mark.parametrize('query', ['CK213', 'style 213', 'AA-CK213-ROYAL-BLUE', 'aa ck213 royal blue', 'aakaar', 'silk', 'net', 'heirloom', 'royal blue'])
def test_actual_endpoint_finds_recorded_fields_and_variant(search_shop, query):
    _, client, first, *_ = search_shop
    payload = client.get('/api/catalog/products', query_string={'q': query}).json
    assert payload['products'][0]['id'] == first
    if query.lower().replace('-', ' ') == 'aa ck213 royal blue':
        assert payload['products'][0]['matchedVariantId'] == 'colour:royal-blue'
    assert '_search_metadata' not in payload['products'][0]


def test_prefix_relevance_counts_suggestions_and_deduplication(search_shop):
    _, client, first, second, third = search_shop
    payload = client.get('/api/catalog/products?q=jaa&pageSize=2').json
    assert [row['id'] for row in payload['products']] == [first, second]
    assert payload['count'] == 3
    assert payload['suggestions'] == ['Jaal Embroidered Lehenga', 'Jaal Work Anarkali']
    all_rows = client.get('/api/catalog/products?q=hastakala').json['products']
    assert {row['id'] for row in all_rows} == {first, second}
    assert len(all_rows) == 2


def test_exact_sku_outranks_description_and_originals_are_unchanged(search_shop):
    db, client, first, *_ = search_shop
    before = list(db.products.find({}))
    payload = client.get('/api/catalog/products?q=AA-CK213-ROYAL-BLUE').json
    assert payload['count'] == 2
    assert payload['products'][0]['id'] == first
    assert list(db.products.find({})) == before


@pytest.mark.parametrize('query', [' JAA  ', 'jAa', 'ÁAKĀR', '!!!', 'not a real piece'])
def test_unicode_whitespace_and_empty_matches(search_shop, query):
    _, client, *ids = search_shop
    payload = client.get('/api/catalog/products', query_string={'q': query}).json
    assert payload['count'] == (3 if query.strip().lower() == 'jaa' else 1 if query == 'ÁAKĀR' else 0)


def test_identifier_normalisation_single_character_and_rank_contract():
    record = {'name': 'Jaal Embroidery', 'sku': 'AA-CK-213', 'description': 'A silk saree', 'variants': [{'id': 'blue', 'sku': 'AA-CK-213-BLUE'}]}
    assert matches_product(record, 'AACK213')
    assert not matches_product(record, 's')
    assert matching_variant(record, 'aa ck 213 blue') == 'blue'
    assert relevance(record, 'AA-CK-213') > relevance(record, 'Jaal Embroidery') > relevance(record, 'jaa') > relevance(record, 'silk')


def test_multiword_name_matches_keep_priority_over_metadata():
    name = {'name': 'Jaal Embroidered Lehenga'}
    metadata = {'name': 'Evening Edit', 'attributes': {'fabric': 'Jaal lehenga'}}
    assert matches_product(name, 'jaal lehenga')
    assert relevance(name, 'jaal lehenga') > relevance(metadata, 'jaal lehenga')


def test_search_retains_canonical_sale_price_and_original_mrp(search_shop):
    from datetime import datetime, timedelta, timezone
    db, client, first, *_ = search_shop
    now = datetime.now(timezone.utc)
    db.admin_settings.insert_one({'_id': 'store', 'salePageEnabled': True})
    db.sale_campaigns.insert_one({'title': 'Synthetic sale', 'publication': 'published', 'startsAt': now-timedelta(hours=1), 'endsAt': now+timedelta(hours=1),
                                 'items': [{'id': 'synthetic-item', 'productId': first, 'variantId': 'colour:royal-blue', 'discountPercent': 20}]})
    row = client.get('/api/catalog/products?q=AA-CK213-ROYAL-BLUE').json['products'][0]
    assert row['price'] == 800 and row['sale']['mrp'] == 1000
    assert row['variants'][0]['sale']['discountPercent'] == 20
    assert db.products.find_one({'_id': ObjectId(first)})['price'] == 1000
