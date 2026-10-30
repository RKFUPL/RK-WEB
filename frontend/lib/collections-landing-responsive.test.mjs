import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const page = readFileSync(new URL('../app/collections/page.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');

test('collections landing keeps its desktop editorial columns and compact mobile grid', () => {
  assert.match(page, /collections-gallery-grid hidden items-start md:grid md:grid-cols-2/);
  assert.match(page, /collections-gallery-column--staggered/);
  assert.match(page, /collections-gallery-grid--mobile grid grid-cols-1 gap-3 min-\[360px\]:grid-cols-2/);
  assert.match(page, /aspect-\[4\/5\].*sm:aspect-\[3\/4\]/);
  assert.match(page, /collections-campaign-shade absolute inset-x-0 bottom-0 h-3\/5[\s\S]*?sm:h-2\/5/);
  assert.match(page, /object-cover object-center/);
  assert.match(page, /collections-landing-card-title/);
  assert.match(page, /lg:text-2xl xl:text-4xl 2xl:text-5xl/);
  assert.match(page, /collections-landing-card-cta/);
  assert.match(page, /collection\.productCount/);
  assert.doesNotMatch(css, /\.collections-campaign-image\s*\{[^}]*aspect-ratio/);
});
