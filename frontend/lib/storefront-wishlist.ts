export type StorefrontWishlistItem = {
  productId: string;
  name: string;
  price?: number;
  image?: string;
  category?: string;
  availability?: string;
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
  const exists = current.some((entry) => entry.productId === item.productId);
  const next = exists
    ? current.filter((entry) => entry.productId !== item.productId)
    : [{ ...item, addedAt: new Date().toISOString() }, ...current];
  writeWishlist(next);
  return !exists;
}

export function removeFromWishlist(productId: string) {
  writeWishlist(readWishlist().filter((item) => item.productId !== productId));
}
