"""Canonical unpaid-order routing and opt-in migration; synthetic evidence only."""
from copy import deepcopy
import pytest

from test_whatsapp_remediation import case
from test_whatsapp_order_mode import order_case
from test_meta_order_mappings import seed_unmapped_observations, approve, saved_order
from app.whatsapp_catalogue import CATALOGUE, EVENT_CATALOGUE
from app.whatsapp_templates import registry, template_registry
from app.whatsapp_mapping_plan import plan_order_template_mappings
from app.whatsapp_orders import order_whatsapp_activity
from app.whatsapp import notify, process_outbox

PARAMETERS = ['customer_name', 'order_number', 'items_summary', 'order_total']
LEGACY = {'name': 'rk_order_placed', 'catalogue': 'rk_order_placed', 'language': 'en_US',
          'category': 'UTILITY', 'parameters': PARAMETERS, 'enabled': True}


@pytest.mark.parametrize('value', ['true', 'false', 1, None])
def test_migration_requires_a_literal_boolean_opt_in(order_case, value):
    with pytest.raises(ValueError, match='migration_opt_in_must_be_boolean'):
        plan_order_template_mappings(order_case.db, order_case.app.config, migrate_order_placed=value)


def test_canonical_default_is_corrected_contract_but_never_implicitly_enabled():
    mapping = registry({})['order_placed']
    assert EVENT_CATALOGUE['order_placed'] == mapping['name'] == mapping['catalogue'] == 'order_received'
    assert mapping['parameters'] == PARAMETERS
    assert not mapping['enabled'] and not mapping['approved']
    assert not CATALOGUE['order_received'].get('activationBlock')
    assert CATALOGUE['order_received']['body'].endswith('progresses.')


@pytest.mark.parametrize('entry', [LEGACY, {'name': 'rk_order_placed', 'enabled': True}])
def test_legacy_configuration_never_silently_falls_back_or_sends(order_case, entry):
    c = order_case
    c.app.config['WHATSAPP_TEMPLATES']['order_placed'] = deepcopy(entry)
    order = saved_order(c, 'order_placed')
    mapping = registry(c.app.config)['order_placed']
    assert mapping['name'] == 'rk_order_placed'
    assert not mapping['enabled'] and mapping['activationBlock'] == 'legacy_template_mapping_requires_migration'
    with c.app.app_context():
        result = notify(c.db, 'order_placed', order)
    assert result['reason'] == 'legacy_template_mapping_requires_migration'
    message = c.db.whatsapp_messages.find_one({'type': 'order_placed'})
    assert message['template'] == 'rk_order_placed' and message['attempts'] == 0
    row = order_whatsapp_activity(c.db, c.app.config, order)['activity'][0]
    assert row['template'] == 'rk_order_placed' and row['reason'] == result['reason']
    assert c.db.whatsapp_outbox.count_documents({}) == 0
    c.http.assert_not_called()


@pytest.mark.parametrize('migrate,enable', [(False, False), (False, True), (True, False), (True, True)])
def test_legacy_migration_and_enabling_require_separate_explicit_opt_ins(order_case, migrate, enable):
    c = order_case; seed_unmapped_observations(c)
    existing = {'order_placed': deepcopy(LEGACY), 'order_confirmation': {'enabled': True},
                'processing': {'enabled': False}, 'unrelated': {'enabled': False}}
    config = {**c.app.config, 'WHATSAPP_TEMPLATES': existing}
    original = deepcopy(existing)
    plan = plan_order_template_mappings(c.db, config, migrate_order_placed=migrate,
        enable_events={'order_placed'} if enable else ())
    check = next(r for r in plan['checks'] if r['event'] == 'order_placed')
    proposed = plan['proposedMappings']['order_placed']
    assert existing == original and not plan['configurationWritten']
    assert check['migrationAppliedToProposal'] is migrate
    assert check['compatible'] is migrate
    if migrate:
        assert proposed['name'] == proposed['catalogue'] == 'order_received'
        assert proposed['parameters'] == PARAMETERS and proposed['enabled'] is enable
    else:
        assert check['reason'] == 'legacy_template_mapping_requires_migration'
        assert proposed == LEGACY
    for name in ('order_confirmation', 'processing', 'unrelated'):
        assert plan['proposedMappings'][name] == existing[name]


@pytest.mark.parametrize('problem', ['missing', 'stale', 'future', 'wrong_waba', 'pending', 'wrong_language',
    'wrong_category', 'wrong_name', 'wrong_components', 'old_body', 'extra_variable'])
def test_migration_never_accepts_invalid_current_waba_evidence(order_case, problem):
    c = order_case; seed_unmapped_observations(c)
    from datetime import timedelta
    from app.whatsapp import now
    config = {**c.app.config, 'WHATSAPP_TEMPLATES': {'order_placed': deepcopy(LEGACY)}}
    query = {'_id': 'order_received:en_US'}
    changes = {'stale': {'checkedAt': now() - timedelta(days=2)}, 'future': {'checkedAt': now() + timedelta(hours=1)},
        'wrong_waba': {'businessAccountId': 'different-waba'}, 'pending': {'status': 'PENDING'},
        'wrong_language': {'language': 'en'}, 'wrong_category': {'category': 'MARKETING'},
        'wrong_name': {'name': 'unrelated'}, 'wrong_components': {'metaComponents': []}}
    if problem == 'missing': c.db.whatsapp_template_status.delete_one(query)
    elif problem in {'old_body', 'extra_variable'}:
        components = c.db.whatsapp_template_status.find_one(query)['metaComponents']
        components[1]['text'] += 'Hello' if problem == 'old_body' else ' {{5}}'
        c.db.whatsapp_template_status.update_one(query, {'$set': {'metaComponents': components}})
    else: c.db.whatsapp_template_status.update_one(query, {'$set': changes[problem]})
    plan = plan_order_template_mappings(c.db, config, enable_events={'order_placed'}, migrate_order_placed=True)
    check = next(r for r in plan['checks'] if r['event'] == 'order_placed')
    assert not check['compatible'] and not check['migrationAppliedToProposal']
    assert plan['proposedMappings']['order_placed'] == LEGACY
    if problem == 'old_body': assert check['reason'] == 'meta_body_correction_required'
    c.http.assert_not_called()


@pytest.mark.parametrize('problem,reason', [('pending', 'template_approval_unverified'),
    ('components', 'template_components_unverified'), ('disabled', 'template_mapping_disabled'),
    ('stale', 'template_evidence_stale'), ('old_body', 'meta_body_correction_required')])
def test_actual_order_activity_and_message_logs_explain_canonical_blocker(order_case, problem, reason):
    c = order_case; approve(c, 'order_placed', 'order_received'); order = saved_order(c, 'order_placed')
    query = {'_id': 'order_received:en_US'}
    from datetime import timedelta
    from app.whatsapp import now
    if problem == 'disabled': c.app.config['WHATSAPP_TEMPLATES']['order_placed']['enabled'] = False
    else:
        changes = {'pending': {'status': 'PENDING'}, 'components': {'componentsVerified': False},
                   'stale': {'checkedAt': now() - timedelta(days=2)}}
        if problem == 'old_body':
            components = c.db.whatsapp_template_status.find_one(query)['metaComponents']; components[1]['text'] += 'Hello'
            changes[problem] = {'metaComponents': components}
        c.db.whatsapp_template_status.update_one(query, {'$set': changes[problem]})
    with c.app.app_context(): assert notify(c.db, 'order_placed', order)['reason'] == reason
    message = c.db.whatsapp_messages.find_one({'type': 'order_placed'})
    assert message['template'] == 'order_received' and message['error']['kind'] == reason
    assert order_whatsapp_activity(c.db, c.app.config, order)['activity'][0]['reason'] == reason
    assert c.db.whatsapp_outbox.count_documents({}) == 0
    c.http.assert_not_called()


def test_planning_is_read_only_and_does_not_replay_recorded_events(order_case):
    c = order_case; approve(c, 'order_placed', 'order_received'); order = saved_order(c, 'order_placed')
    with c.app.app_context(): assert notify(c.db, 'order_placed', order)['status'] == 'queued'
    assert process_outbox(c.db, c.app.config) == 1
    before = list(c.db.whatsapp_order_events.find())
    messages = list(c.db.whatsapp_messages.find())
    plan_order_template_mappings(c.db, c.app.config, enable_events={'order_placed'}, migrate_order_placed=True)
    assert list(c.db.whatsapp_order_events.find()) == before and list(c.db.whatsapp_messages.find()) == messages
    with c.app.app_context(): assert notify(c.db, 'order_placed', order)['status'] == 'duplicate'
    assert process_outbox(c.db, c.app.config) == 0
    c.http.assert_called_once()
