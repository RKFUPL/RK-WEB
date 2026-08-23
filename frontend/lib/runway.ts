import type { CatalogProduct, ManagedCollection } from '@/lib/catalog';

export type StorefrontRunwayCollection = ManagedCollection & { products: CatalogProduct[] };
export type RunwayPagination = {
  page: number;
  pageSize: number;
  totalProducts: number;
  totalPages: number;
};

export const runwayPageSize = 3;

export const runwayCollectionApiPath = '/api/catalog/runway';

export function runwayProductHref(product: Pick<CatalogProduct, 'id' | 'slug'>) {
  return `/runway/LFW/${encodeURIComponent(product.slug || product.id)}`;
}
