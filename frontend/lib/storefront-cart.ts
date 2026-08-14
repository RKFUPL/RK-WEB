import { addToCart, emptyCart, removeFromCart } from '@/lib/cart';
import type { Cart, CartItem } from '@/lib/store-types';

export const cartStorageKey = 'rk_shopping_bag';
export const cartChangedEvent = 'rk:cart-changed';

export function readStoredCart(): Cart {
  if (typeof window === 'undefined') return emptyCart;
  try {
    const value = JSON.parse(window.localStorage.getItem(cartStorageKey) || 'null');
    return value && Array.isArray(value.items) ? { items: value.items, currency: 'INR' } : emptyCart;
  } catch {
    return emptyCart;
  }
}

export function writeStoredCart(cart: Cart) {
  window.localStorage.setItem(cartStorageKey, JSON.stringify(cart));
  window.dispatchEvent(new CustomEvent(cartChangedEvent, { detail: cart }));
}

export function addStoredCartItem(item: CartItem) {
  const next = addToCart(readStoredCart(), item);
  writeStoredCart(next);
  return next;
}

export function removeStoredCartItem(productId: string, variantId?: string) {
  const next = removeFromCart(readStoredCart(), productId, variantId);
  writeStoredCart(next);
  return next;
}
