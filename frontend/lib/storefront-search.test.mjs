import test from 'node:test';
import { collectionDisplayName } from './home-content.ts';
import assert from 'node:assert/strict';
import { matchesSearch, searchTokens, searchRelevance, uniqueSuggestions } from './storefront-search.ts';

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


test('relevance orders exact and prefix matches before broad metadata', () => {
  assert.ok(searchRelevance('Jaal', 'jaal') > searchRelevance('Jaal lehenga', 'jaal'));
  assert.ok(searchRelevance('Jaal lehenga', 'jaal') > searchRelevance('Ivory jaal saree', 'jaal'));
  assert.deepEqual(uniqueSuggestions(['Jaal', 'jaal', 'Jaal work', 'unrelated'], 'jaa'), ['Jaal', 'Jaal work']);
});

test('collection display names preserve persisted casing without slug or seed overrides', () => {
  for (const name of ['Aakaar','Hastakala','Inaara','Anamika','Naqab','Sandook']) assert.equal(collectionDisplayName({name}), name);
  assert.equal(collectionDisplayName({name:'AAKAAR',slug:'aakaar'}), 'AAKAAR');
  assert.equal(collectionDisplayName({name:'Custom EDIT',slug:'aakaar'}), 'Custom EDIT');
  assert.equal(collectionDisplayName({name:' Aakaar ',slug:'aakaar'}), 'Aakaar');
  assert.equal(matchesSearch('Jaal silk', '\uff2a\uff21\uff21'), true);
});

test('single-character queries do not match unrelated prose', () => {
  assert.equal(matchesSearch('Jaal embroidery', 'j'), true);
  assert.equal(matchesSearch('Hastakala handcrafted jaal', 'j'), false);
});
