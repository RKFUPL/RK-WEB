import { addToCart, emptyCart, removeFromCart, cartLineKey, updateCartItemSize } from '@/lib/cart';
import { isDisplayCurrency } from '@/lib/currency';
import type { Cart, CartItem } from '@/lib/store-types';

export const cartStorageKey = 'rk_shopping_bag';
export const cartChangedEvent = 'rk:cart-changed';

export function readStoredCart(): Cart {
  if (typeof window === 'undefined') return emptyCart;
  try {
    const value = JSON.parse(window.localStorage.getItem(cartStorageKey) || 'null');
    return value && Array.isArray(value.items)
      ? { items: value.items.map((item: CartItem) => item?.inventoryMode === 'variant' ? { ...item, stock: undefined } : item), currency: isDisplayCurrency(value.currency) ? value.currency : 'INR' }
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


/** Refresh only prices on the current bag; edits made during the request survive. */
let nextPriceRefresh: ReturnType<typeof setTimeout> | undefined;
let priceRefreshRunning = false;
export async function refreshStoredCartPrices() {
  if (priceRefreshRunning) return;
  priceRefreshRunning = true;
  const cart = readStoredCart();
  if (!cart.items.length) { priceRefreshRunning = false; return; }
  try {
    const { apiBaseUrl } = await import('./rbac');
    const response = await fetch(`${apiBaseUrl}/api/sales/prices`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store', body: JSON.stringify({ items: cart.items.map(i => ({ productId: i.productId, variantId: i.variantId })) }) });
    if (!response.ok) return;
    const data = await response.json();
    const current = readStoredCart();
    const items = current.items.map(item => {
      const price = (data.prices || []).find((p: CartItem) => p.productId === item.productId && p.variantId === item.variantId);
      return price && Number.isFinite(price.price) && price.price > 0 ? { ...item, price: price.price, sale: price.sale } : item;
    });
    if (JSON.stringify(items) !== JSON.stringify(current.items)) writeStoredCart({ ...current, items });
    clearTimeout(nextPriceRefresh);
    const deadlines = items.filter(i => i.sale?.isOnSale && i.sale.saleEndsAt && i.sale.serverTime).map(i => Date.parse(i.sale!.saleEndsAt!) - Date.parse(i.sale!.serverTime!));
    if (deadlines.length) {
      const expiring = items.filter(i => i.sale?.isOnSale && i.sale.saleEndsAt && i.sale.serverTime && Date.parse(i.sale.saleEndsAt)-Date.parse(i.sale.serverTime) === Math.min(...deadlines));
      nextPriceRefresh = setTimeout(() => {
        const bag = readStoredCart();
        writeStoredCart({ ...bag, items: bag.items.map(i => expiring.some(e => e.productId===i.productId && e.variantId===i.variantId && e.sale?.saleCampaignId===i.sale?.saleCampaignId && e.sale?.saleEndsAt===i.sale?.saleEndsAt) && i.sale?.mrp ? { ...i, price:i.sale.mrp, sale:undefined } : i) });
        void refreshStoredCartPrices();
      }, Math.max(50, Math.min(...deadlines, 2147483647)));
    }
  } catch { /* Checkout independently fails closed and compares the quoted amount. */ } finally { priceRefreshRunning = false; }
}
