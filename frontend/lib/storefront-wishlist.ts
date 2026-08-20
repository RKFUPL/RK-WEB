export type StorefrontWishlistItem = {
  productId: string;
  variantId?: string;
  sku?: string;
  colour?: string;
  name: string;
  price?: number;
  image?: string;
  category?: string;
  availability?: string;
  stock?: number;
  sizeOptions?: string[];
  sizeStock?: Record<string, number>;
  route: string;
  addedAt: string;
};

export const wishlistStorageKey = 'rk_wishlist_products';
export const wishlistChangedEvent = 'rk:wishlist-changed';

export function readWishlist(): StorefrontWishlistItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const value = JSON.parse(window.localStorage.getItem(wishlistStorageKey) || '[]');
    return Array.isArray(value) ? value.filter((item) => item && typeof item.productId === 'string') : [];
  } catch {
    return [];
  }
}

export function writeWishlist(items: StorefrontWishlistItem[]) {
  window.localStorage.setItem(wishlistStorageKey, JSON.stringify(items));
  window.dispatchEvent(new CustomEvent(wishlistChangedEvent, { detail: items }));
}

export function toggleWishlist(item: Omit<StorefrontWishlistItem, 'addedAt'>) {
  const current = readWishlist();
  const identity = (entry: Pick<StorefrontWishlistItem, 'productId' | 'sku' | 'variantId'>) => `${entry.productId}:${entry.sku || entry.variantId || 'default'}`;
  const exists = current.some((entry) => identity(entry) === identity(item));
  const next = exists
    ? current.filter((entry) => identity(entry) !== identity(item))
    : [{ ...item, addedAt: new Date().toISOString() }, ...current];
  writeWishlist(next);
  return !exists;
}

export function removeFromWishlist(productId: string, sku?: string) {
  writeWishlist(readWishlist().filter((item) => !(item.productId === productId && (!sku || item.sku === sku))));
}
