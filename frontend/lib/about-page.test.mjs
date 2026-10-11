import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const aboutSource = readFileSync(new URL('../app/about/page.tsx', import.meta.url), 'utf8');
const headerSource = readFileSync(new URL('../components/home/sticky-header.tsx', import.meta.url), 'utf8');
const footerSource = readFileSync(new URL('../components/home/footer.tsx', import.meta.url), 'utf8');

test('About page contains the requested editorial sections and designer image slot', () => {
  assert.match(aboutSource, /A story<br \/>in every<br \/>/);
  assert.match(aboutSource, />thread\.<\/em>/);
  assert.match(aboutSource, />The Brand<\/p>/);
  assert.match(aboutSource, />The Designer<\/p>/);
  assert.match(aboutSource, /Our people and process/);
  assert.match(aboutSource, /Craftsmanship/);
  assert.match(aboutSource, /Thoughtful creation/);
  assert.match(aboutSource, /const DESIGNER_IMAGE_URL = '';/);
  assert.match(aboutSource, /Designer portrait coming soon/);
});

test('Existing header and footer navigation continue to use the canonical About route', () => {
  assert.match(headerSource, /router\.push\('\/about'\)/);
  assert.match(footerSource, /label: 'About', href: '\/about'/);
});
