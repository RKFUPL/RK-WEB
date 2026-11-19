import test from 'node:test';
import assert from 'node:assert/strict';
import { diagnosticCounts, safeDiagnosticEvidence } from './whatsapp-diagnostics.ts';

test('diagnostic counts keep unknown, unverified and stale evidence separate from blockers', () => {
  const values = ['VERIFIED', 'ACTION REQUIRED', 'BLOCKED', 'UNKNOWN', 'NOT VERIFIED', 'STALE EVIDENCE', 'NOT_VERIFIED'];
  const keys = ['configuration', 'billing', 'sender', 'templates', 'webhook', 'worker', 'outbox'];
  assert.deepEqual(diagnosticCounts(keys.map((key, index) => ({ key, status: values[index] }))), { verified: 1, action: 1, blocked: 1, unknown: 4 });
});

test('missing checks remain unknown rather than verified or blocked', () => {
  assert.deepEqual(diagnosticCounts(), { verified: 0, action: 0, blocked: 0, unknown: 7 });
  assert.deepEqual(diagnosticCounts([{ key: 'sender', status: 'VERIFIED' }]), { verified: 1, action: 0, blocked: 0, unknown: 6 });
});

test('display guard removes sensitive fields recursively from structured and raw evidence', () => {
  const evidence = { accessToken: 'private-token', appSecret: 'private-secret', webhookSecret: 'private-webhook',
    customerPhone: '+14155552671', messageBody: 'private message', nested: { authorization: 'Bearer private', payload: { recipient: '+14155552671' }, safe: true } };
  assert.deepEqual(safeDiagnosticEvidence(evidence), { nested: { safe: true } });
  assert.equal(safeDiagnosticEvidence('Provider included Bearer private-token and +14155552671'), 'Provider included [redacted] and [redacted]');
});

test('display guard preserves scoped provider IDs, masked phone and capacity fields', () => {
  const evidence = { phoneNumberId: '482608498260686', phoneMasked: '***8080', messagingCapacity: { uniqueRecipientsPer24Hours: 250, providerEnforced: true }, imageParity: 'UNKNOWN (host access required)' };
  assert.deepEqual(safeDiagnosticEvidence(evidence), evidence);
});
