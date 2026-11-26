import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

// Exercise the real client with a synthetic API base and mocked transport only.
const hooks = registerHooks({resolve(specifier, context, next) {
  if (specifier === '@/lib/rbac') return {url:'data:text/javascript,export const apiBaseUrl = "";',shortCircuit:true};
  return next(specifier, context);
}});
const { fetchCatalogCollections } = await import('./catalog-client.ts');
hooks.deregister();

test('collection requests share in-flight work but read fresh saved names after completion', async () => {
  const original = globalThis.fetch;
  let resolveRequest, calls = 0;
  globalThis.fetch = () => { calls++; return new Promise(resolve => { resolveRequest = resolve; }); };
  try {
    const first = fetchCatalogCollections();
    assert.equal(fetchCatalogCollections(), first);
    resolveRequest(Response.json({collections:[{id:'saved',slug:'aakaar',name:'AAKAAR'}]}));
    assert.equal((await first)[0].name, 'AAKAAR');
    const fresh = fetchCatalogCollections();
    assert.notEqual(fresh, first);
    resolveRequest(Response.json({collections:[{id:'saved',slug:'aakaar',name:'Aakaar'}]}));
    assert.equal((await fresh)[0].name, 'Aakaar');
    assert.equal(calls, 2);
  } finally { globalThis.fetch = original; }
});
