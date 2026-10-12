import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const layout = readFileSync(new URL('../app/layout.tsx', import.meta.url), 'utf8');
const globals = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
const workflow = readFileSync(new URL('../../.github/workflows/deploy.yml', import.meta.url), 'utf8');

test('production layout does not fetch Google fonts during the build', () => {
  assert.doesNotMatch(layout, /next\/font\/google/);
  assert.match(layout, /next\/font\/local/);
  assert.match(layout, /HV-Muse-Regular\.otf/);
});

test('premium typography keeps the intended families and local fallbacks', () => {
  assert.match(globals, /--font-display: "Cormorant Garamond", "Iowan Old Style", Baskerville, "Times New Roman", serif;/);
  assert.match(globals, /--font-body: Inter, "Segoe UI", Arial, sans-serif;/);
});

test('deployment stops on shell errors without the removed script_stop input', () => {
  assert.doesNotMatch(workflow, /script_stop:/);
  assert.match(workflow, /script: \|\r?\n\s+set -e/);
});
