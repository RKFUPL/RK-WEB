import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const homeContent = readFileSync(new URL('./home-content.ts', import.meta.url), 'utf8');
const services = readFileSync(new URL('../components/home/services.tsx', import.meta.url), 'utf8');
const admin = readFileSync(new URL('../components/admin/admin-testimonials.tsx', import.meta.url), 'utf8');
const saveWorkflow = admin.slice(admin.indexOf('const save = async'), admin.indexOf('const setPublished'));

test('storefront testimonials come from the published content endpoint without placeholders', () => {
  assert.doesNotMatch(homeContent, /Lorem ipsum|Ananya S\.|Image not found/i);
  assert.match(services, /\/api\/content\/testimonials/);
  assert.match(services, /if \(!ready \|\| !items\.length\) return null/);
  assert.match(services, /onError=\{\(\) => setFailed\(true\)\}/);
});

test('admin testimonial manager uses persistent CRUD endpoints and publication state', () => {
  assert.match(admin, /\/api\/admin\/testimonials/);
  assert.match(admin, /method: editingId \? 'PATCH' : 'POST'/);
  assert.match(admin, /method: 'DELETE'/);
  assert.match(admin, /status === 'published'/);
});

test('admin testimonial editor separates managed WorkDrive media from public image URLs', () => {
  assert.match(admin, /Managed WorkDrive image \(optional\)/);
  assert.match(admin, /provider: 'zoho_workdrive'/);
  assert.match(admin, /Public image URL \(optional\)/);
  assert.match(admin, /res\.cloudinary\.com/);
  assert.match(admin, /imageMedia: event\.target\.value \? null/);
  assert.match(admin, /workdrive\.zohoexternal\.in\/external/);
  assert.match(saveWorkflow, /catch \(requestError\).*setError/s);
  assert.doesNotMatch(saveWorkflow.slice(saveWorkflow.indexOf('catch')), /reset\(\)/);
  assert.match(admin, /min-h-12 text-base/);
  assert.match(admin, /max-w-6xl/);
});
