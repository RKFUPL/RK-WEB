"""Synthetic MongoMock list regression/benchmark; never uses configured MongoDB."""
from collections import Counter
from contextlib import ExitStack
from datetime import datetime, timedelta, timezone
from time import perf_counter
from unittest.mock import patch

import mongomock
from bson import ObjectId
from flask import Flask
import pytest

from app.blueprints.orders import routes


@pytest.fixture
def order_list():
    db = mongomock.MongoClient(tz_aware=True).order_list_test
    now = datetime.now(timezone.utc)
    for index in range(220):
        status = ['processing', 'packed', 'cancelled', 'return_requested'][index % 4]
        db.orders.insert_one({'_id': ObjectId(), 'orderNumber': f'RK-SYNTHETIC-{index:03}',
            'customerName': 'Synthetic customer', 'email': 'synthetic@example.test',
            'createdAt': now - timedelta(minutes=index), 'updatedAt': now,
            'paymentGateway': 'manual', 'payment': {'status': 'pending', 'gateway': 'manual'},
            'paymentStatus': 'pending', 'fulfillmentStatus': status, 'status': status,
            'fulfillment': {'status': status, 'trackingNumber': f'SYNTHETIC-{index:03}'},
            'total': 100, 'items': [], 'timeline': [], 'paymentTransactions': [],
            'availabilityDecision': {'status': 'accepted'}})
    app = Flask(__name__)
    app.config.update(TESTING=True, WHATSAPP_ENABLED=False, WHATSAPP_ORDER_NOTIFICATIONS_ENABLED=False)
    with patch.object(routes, 'database', return_value=db), patch.object(routes, 'current_user', return_value={}):
        yield app, db


def request_list(app, query=''):
    with app.test_request_context('/api/staff/orders' + query):
        response, status = routes.list_staff_orders.__wrapped__()
        assert status == 200
        return response.get_json()


def test_synthetic_list_benchmark(order_list):
    app, db = order_list
    queries = Counter()
    depth = 0
    # Count collection API operations, not real network round trips.
    with ExitStack() as stack:
        for name in ['find', 'find_one', 'count_documents', 'distinct', 'aggregate', 'update_one', 'update_many', 'create_index']:
            original = getattr(mongomock.collection.Collection, name)
            def counted(self, *args, _name=name, _original=original, **kwargs):
                nonlocal depth
                if depth == 0:
                    queries[_name] += 1
                depth += 1
                try:
                    return _original(self, *args, **kwargs)
                finally:
                    depth -= 1
            stack.enter_context(patch.object(mongomock.collection.Collection, name, counted))
        start = perf_counter()
        payload = request_list(app)
        elapsed = (perf_counter() - start) * 1000
    reads = sum(queries[key] for key in ('find', 'find_one', 'count_documents', 'distinct', 'aggregate'))
    print(f'\nSYNTHETIC_LIST_BENCHMARK rows={len(payload["orders"])} total=220 ms={elapsed:.2f} read_operations={reads} collection_operations={sum(queries.values())} operations={dict(queries)}')
    assert payload['orders']


def test_rows_are_lightweight_and_never_build_detail_activity(order_list):
    app, db = order_list
    with patch.object(routes, '_staff_view', side_effect=AssertionError('detail called')), \
         patch.object(routes, 'order_whatsapp_activity', side_effect=AssertionError('activity called')), \
         patch('app.inventory_operations.operation_evidence', side_effect=AssertionError('inventory called')):
        payload = request_list(app)
    assert len(payload['orders']) == 50
    assert (payload['total'], payload['totalPages'], payload['pageSize']) == (220, 5, 50)
    for row in payload['orders']:
        assert not {'items', 'timeline', 'notificationActivity', 'whatsapp', 'inventoryReconciliation', 'paymentTransactions'} & row.keys()


def test_pagination_search_filters_and_global_counts(order_list):
    app, db = order_list
    seen = []
    for page in range(1, 6):
        payload = request_list(app, f'?page={page}')
        seen.extend(row['id'] for row in payload['orders'])
        assert payload['counts']['fulfillment']['returns'] == 55
        assert payload['counts']['fulfillment']['cancelled'] == 55
        assert payload['counts']['payment']['pending'] == 220
    assert len(seen) == len(set(seen)) == 220
    assert request_list(app, '?q=SYNTHETIC-219')['orders'][0]['orderNumber'] == 'RK-SYNTHETIC-219'
    filtered = request_list(app, '?payment=pending&fulfillment=processing&page=2')
    assert filtered['total'] == 55 and len(filtered['orders']) == 5
    assert all(row['fulfillmentStatus'] == 'processing' for row in filtered['orders'])
    assert 'counts' not in request_list(app, '?page=2&includeCounts=false')


def test_legacy_reads_do_not_migrate_and_indexes_are_once_per_app(order_list):
    app, db = order_list
    legacy_id = db.orders.insert_one({'orderNumber': 'RK-LEGACY', 'status': 'fulfilled', 'paymentStatus': 'paid'}).inserted_id
    before = db.orders.find_one({'_id': legacy_id})
    with patch.object(routes, 'ensure_order_indexes') as indexes:
        payload = request_list(app, '?q=RK-LEGACY&fulfillment=delivered&payment=paid')
        request_list(app)
    assert indexes.call_count == 1
    assert payload['orders'][0]['fulfillmentStatus'] == 'delivered'
    assert db.orders.find_one({'_id': legacy_id}) == before
    from app.order_fulfillment import migrate_legacy_orders
    migrate_legacy_orders(db)
    migrated = db.orders.find_one({'_id': legacy_id})
    migrate_legacy_orders(db)
    assert db.orders.find_one({'_id': legacy_id}) == migrated


def test_counts_use_exact_refund_ledger_and_closed_overdue_rules(order_list):
    app, db = order_list
    now = datetime.now(timezone.utc)
    db.orders.delete_many({})
    payment_id = 'synthetic-payment'
    db.orders.insert_many([
        {'total': 100, 'paymentGateway': 'manual', 'fulfillment': {'status': 'processing'}, 'paymentTransactions': [{'amountPaise': 3000}], 'paymentDueAt': now - timedelta(days=1)},
        {'total': 100, 'paymentGateway': 'manual', 'fulfillment': {'status': 'cancelled'}, 'paymentTransactions': [], 'paymentDueAt': now - timedelta(days=1)},
        {'total': 100, 'paymentStatus': 'refunded', 'fulfillment': {'status': 'refunded'}, 'razorpayPaymentId': payment_id, 'paymentVerifiedAt': now,
         'refunds': [{'id': 'synthetic-refund', 'paymentId': payment_id, 'currency': 'INR', 'status': 'processed', 'source': 'razorpay_signed_webhook', 'amountPaise': 5000, 'processedAt': now}]},
        {'total': 100, 'paymentStatus': 'refunded', 'fulfillment': {'status': 'returned'}},
    ])
    with app.app_context():
        counts = routes._order_counts(db)
    assert counts['payment']['overdue'] == 1
    assert counts['payment']['pending'] == 2
    assert counts['payment']['partially_refunded'] == 1
    assert counts['fulfillment']['returns'] == 2
    # No server cache: a ledger change is reflected on the next summary read.
    db.orders.update_one({'paymentGateway': 'manual', 'fulfillment.status': 'processing'}, {'$set': {'paymentTransactions': [{'amountPaise': 10000}]}})
    with app.app_context():
        updated = routes._order_counts(db)
    assert updated['payment']['paid'] == 1 and updated['payment']['overdue'] == 0


def test_list_timings_never_log_customer_or_search_values(order_list, caplog):
    app, db = order_list
    caplog.set_level('INFO')
    request_list(app, '?q=SYNTHETIC')
    for phase in ('orders.query', 'orders.counts', 'orders.list_serialization', 'orders.list_total'):
        assert phase in caplog.text
    assert 'synthetic@example.test' not in caplog.text
    assert 'Synthetic customer' not in caplog.text
    assert 'SYNTHETIC' not in caplog.text


def test_count_projection_preserves_currency_binding(order_list):
    app, db = order_list
    now = datetime.now(timezone.utc)
    db.orders.delete_many({})
    order = {'total': 100, 'currency': 'USD', 'paymentStatus': 'refunded', 'status': 'returned',
        'razorpayPaymentId': 'synthetic-payment', 'paymentVerifiedAt': now,
        'refunds': [{'id': 'synthetic-refund', 'paymentId': 'synthetic-payment', 'currency': 'USD', 'status': 'processed', 'source': 'razorpay_signed_webhook', 'amountPaise': 10000, 'processedAt': now}]}
    db.orders.insert_one(order)
    with app.app_context():
        assert routes._order_counts(db)['payment']['refunded'] == 1
    assert request_list(app)['orders'][0]['paymentStatus'] == 'refunded'


def test_customer_legacy_scope_still_works_without_request_wide_migration(order_list):
    app, db = order_list
    customer_id = ObjectId()
    db.orders.insert_many([
        {'orderNumber': 'LEGACY-PAST', 'customerId': customer_id, 'status': 'fulfilled', 'paymentStatus': 'paid', 'total': 100},
        {'orderNumber': 'LEGACY-ACTIVE', 'customerId': customer_id, 'status': 'processing', 'paymentStatus': 'paid', 'total': 100},
        {'orderNumber': 'OTHER-CUSTOMER', 'customerId': ObjectId(), 'status': 'processing', 'paymentStatus': 'paid', 'total': 100},
    ])
    with patch.object(routes, 'authenticated_user_id', return_value=customer_id), \
         patch.object(routes, '_customer_view', side_effect=lambda db, order: {'orderNumber': order['orderNumber']}):
        for scope, number in [('active', 'LEGACY-ACTIVE'), ('past', 'LEGACY-PAST')]:
            with app.test_request_context('/api/orders?scope=' + scope):
                response, status = routes.list_customer_orders.__wrapped__()
                assert status == 200
                payload = response.get_json()
                assert payload['orders'] == [{'orderNumber': number}]
                assert payload['counts'] == {'active': 1, 'past': 1, 'all': 2}
