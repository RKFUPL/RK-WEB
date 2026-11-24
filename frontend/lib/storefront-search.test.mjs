import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesSearch, searchTokens } from './storefront-search.ts';

test('search matches normalized codes, slugs, multiword terms and Unicode', () => {
  for (const query of ['hastakala', 'CK184', 'HK-CK184-RED', 'red ruhani', 'silk', 'style 02'])
    assert.equal(matchesSearch('RUHANI HK-CK184-RED Hastakala silk STYLE-02', query), true, query);
  assert.equal(matchesSearch('All Lookbooks editorial', 'lookbook'), true);
  assert.deepEqual(searchTokens('  ÁAKĀAR / couture '), ['áakāar', 'couture']);
});

test('punctuation-only and unmatched searches do not match all pages', () => {
  assert.equal(matchesSearch('About Rashi Kapoor', '!!!'), false);
  assert.equal(matchesSearch('Hastakala', 'missing'), false);
  assert.equal(matchesSearch('Hastakala', ''), true);
});
