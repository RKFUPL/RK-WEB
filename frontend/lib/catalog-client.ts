import type { ManagedCollection } from '@/lib/catalog';
import { apiBaseUrl } from '@/lib/rbac';

type CollectionIndexResponse = { collections: ManagedCollection[] };

let collectionsRequest: Promise<ManagedCollection[]> | null = null;

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
