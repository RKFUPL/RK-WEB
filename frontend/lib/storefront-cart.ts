import { addToCart, emptyCart, removeFromCart, cartLineKey, updateCartItemSize } from '@/lib/cart';
import type { Cart, CartItem } from '@/lib/store-types';

export const cartStorageKey = 'rk_shopping_bag';
export const cartChangedEvent = 'rk:cart-changed';

export function readStoredCart(): Cart {
  if (typeof window === 'undefined') return emptyCart;
  try {
    const value = JSON.parse(window.localStorage.getItem(cartStorageKey) || 'null');
    return value && Array.isArray(value.items)
      ? { items: value.items.map((item: CartItem) => item?.inventoryMode === 'variant' ? { ...item, stock: undefined } : item), currency: 'INR' }
      : emptyCart;
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

export function removeStoredCartItem(productId: string, variantId?: string, lineKey?: string) {
  const next = removeFromCart(readStoredCart(), productId, variantId, lineKey);
  writeStoredCart(next);
  return next;
}

export function updateStoredCartQuantity(productId: string, quantity: number, variantId?: string, lineKey?: string) {
  const cart = readStoredCart();
  const nextQuantity = Math.min(50, quantity);
  const next = quantity <= 0
    ? removeFromCart(cart, productId, variantId, lineKey)
    : {
        ...cart,
        items: cart.items.map((item) => (lineKey ? cartLineKey(item) === lineKey : item.productId === productId && (item.variantId || item.variant?.id) === variantId) ? { ...item, quantity: nextQuantity } : item),
      };
  writeStoredCart(next);
  return next;
}

export function updateStoredCartSize(lineKey: string, size: string) {
  const next = updateCartItemSize(readStoredCart(), lineKey, size);
  writeStoredCart(next);
  return next;
}
