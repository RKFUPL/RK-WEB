import type { CatalogProduct, ManagedCollection } from '@/lib/catalog';
import { apiBaseUrl } from '@/lib/rbac';

type CollectionIndexResponse = { collections: ManagedCollection[] };

let collectionsRequest: Promise<ManagedCollection[]> | null = null;
const collectionDetailRequests = new Map<string, { expiresAt: number; request: Promise<ManagedCollection & { products: CatalogProduct[] }> }>();
const COLLECTION_DETAIL_TTL_MS = 30_000;

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
      });
  }
  return collectionsRequest;
}

export function fetchCatalogCollection(slug: string): Promise<ManagedCollection & { products: CatalogProduct[] }> {
  const key = String(slug || '').trim().toLowerCase();
  const now = Date.now();
  const cached = collectionDetailRequests.get(key);
  if (cached && cached.expiresAt > now) return cached.request;

  const request = fetch(`${apiBaseUrl}/api/catalog/collections/${encodeURIComponent(slug)}`)
    .then(async (response) => {
      const payload = await response.json() as { collection?: ManagedCollection & { products: CatalogProduct[] }; error?: string };
      if (!response.ok || !payload.collection) throw new Error(payload.error || 'Unable to load collection.');
      return payload.collection;
    })
    .catch((error) => {
      if (collectionDetailRequests.get(key)?.request === request) collectionDetailRequests.delete(key);
      throw error;
    });
  collectionDetailRequests.set(key, { expiresAt: now + COLLECTION_DETAIL_TTL_MS, request });
  return request;
}
