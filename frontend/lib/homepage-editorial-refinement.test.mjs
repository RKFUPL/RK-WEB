import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (relativePath) => readFileSync(new URL(relativePath, import.meta.url), 'utf8');
const hero = read('../components/home/featured-collection.tsx');
const collections = read('../components/home/shop-categories.tsx');
const careers = read('../components/home/newsletter.tsx');
const careersPage = read('../app/careers/page.tsx');
const footer = read('../components/home/footer.tsx');
const header = read('../components/home/sticky-header.tsx');

test('homepage hero keeps photography clear of right-side editorial metadata', () => {
  assert.doesNotMatch(hero, /Indian couture/);
  assert.doesNotMatch(hero, /A new chapter/);
  assert.doesNotMatch(hero, /quiet couture/);
  assert.match(hero, /Previous Aakaar image/);
  assert.match(hero, /Next Aakaar image/);
});

test('collection and careers sections retain the approved editorial copy', () => {
  assert.match(collections, /Where the art of/);
  assert.match(collections, /draping meets/);
  assert.match(collections, /timeless luxury\./);
  assert.match(collections, /An expression of our design philosophy/);
  assert.match(careers, /An Invitation into Our World/);
  assert.match(careers, /Your vision belongs here\./);
  assert.match(careers, /Explore our opportunities and apply to join the House today\./);
  assert.match(careers, /href="\/careers"/);
  assert.match(careersPage, /mailto:hr@rashikapoorofficial\.com/);
});

test('flagship and location content removes the retired supporting treatments', () => {
  assert.match(footer, />The Flagship</);
  assert.doesNotMatch(footer, /The house in person/i);
  assert.doesNotMatch(footer, /Store locator<br \/>Private appointments/);
  assert.doesNotMatch(footer, /Private appointments, considered fittings/);
  assert.match(footer, /Kolkata &amp; Mumbai\./);
});

test('header retains core destinations while increasing readable control sizing', () => {
  for (const label of ['Home', 'Collections', 'About', 'Contact']) assert.match(header, new RegExp(`>${label}<`));
  assert.match(header, /text-\[0\.78rem\]/);
  assert.match(header, /lg:h-12/);
  assert.match(header, /h-\[1\.15rem\] w-\[1\.15rem\]/);
  assert.doesNotMatch(header, /ForexTicker/);
});
