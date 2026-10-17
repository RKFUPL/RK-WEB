import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const careers = readFileSync(new URL('../components/home/newsletter.tsx', import.meta.url), 'utf8');

test('homepage presents the approved careers editorial and destination', () => {
  assert.match(careers, /Careers at RK/);
  assert.match(careers, /Be part/);
  assert.match(careers, /of the House\./);
  assert.match(careers, /href="\/careers"/);
  assert.match(careers, /Explore careers/);
});

test('homepage no longer renders the superseded newsletter form', () => {
  assert.doesNotMatch(careers, /House notes/);
  assert.doesNotMatch(careers, /newsletter-email/);
  assert.doesNotMatch(careers, /Subscribe/);
});
