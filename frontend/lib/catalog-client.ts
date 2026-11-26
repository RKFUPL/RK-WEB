import type { CatalogProduct, ManagedCollection } from '@/lib/catalog';
import { apiBaseUrl } from '@/lib/rbac';

type CollectionIndexResponse = { collections: ManagedCollection[] };
export type CatalogSearchProduct = CatalogProduct & { matchedVariantId?: string; collections?: Array<{ id: string; name: string; slug: string }> };

let collectionsRequest: Promise<ManagedCollection[]> | null = null;
// Share in-flight requests, but never retain completed price-bearing responses.
const collectionDetailRequests = new Map<string, Promise<ManagedCollection & { products: CatalogProduct[] }>>();

export function fetchCatalogCollections(): Promise<ManagedCollection[]> {
  if (!collectionsRequest) {
    collectionsRequest = fetch(`${apiBaseUrl}/api/catalog/collections`, { cache: 'no-store' })
      .then(async (response) => {
        const payload = await response.json() as CollectionIndexResponse & { error?: string };
        if (!response.ok) throw new Error(payload.error || 'Unable to load collections.');
        return payload.collections || [];
      })
      .catch((error) => {
        collectionsRequest = null;
        throw error;
      })
      .finally(() => { collectionsRequest = null; });
  }
  return collectionsRequest;
}

export function fetchCatalogCollection(slug: string): Promise<ManagedCollection & { products: CatalogProduct[] }> {
  const key = String(slug || '').trim().toLowerCase();
  const cached = collectionDetailRequests.get(key);
  if (cached) return cached;

  const request = fetch(`${apiBaseUrl}/api/catalog/collections/${encodeURIComponent(slug)}`, { cache: 'no-store' })
    .then(async (response) => {
      const payload = await response.json() as { collection?: ManagedCollection & { products: CatalogProduct[] }; error?: string };
      if (!response.ok || !payload.collection) throw new Error(payload.error || 'Unable to load collection.');
      return payload.collection;
    })
    .finally(() => {
      if (collectionDetailRequests.get(key) === request) collectionDetailRequests.delete(key);
    });
  collectionDetailRequests.set(key, request);
  return request;
}

export async function searchCatalogProducts(query: string, signal: AbortSignal): Promise<{products: CatalogSearchProduct[]; count: number; suggestions: string[]}> {
  const trimmed = query.trim();
  if (!trimmed) return {products: [], count: 0, suggestions: []};
  const params = new URLSearchParams({ q: trimmed, pageSize: '4' });
  const response = await fetch(`${apiBaseUrl}/api/catalog/products?${params}`, { cache: 'no-store', signal });
  if (!response.ok) throw new Error('Product search could not be loaded. Please try again.');
  const payload = await response.json() as { products?: CatalogSearchProduct[]; count?: number; suggestions?: string[] };
  if (!Array.isArray(payload.products)) throw new Error('Product search could not be loaded. Please try again.');
  return {products: payload.products, count: payload.count ?? payload.products.length, suggestions: payload.suggestions || []};
}
