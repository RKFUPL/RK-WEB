import type { Cart, CartItem } from './store-types';

export const emptyCart: Cart = {
  items: [],
  currency: 'INR',
};

export function getCartItemCount(cart: Cart) {
  return cart.items.reduce((total, item) => total + item.quantity, 0);
}

export function getCartSubtotal(cart: Cart) {
  return cart.items.reduce((total, item) => total + item.price * item.quantity, 0);
}

export function cartLineKey(item: Pick<CartItem, 'productId' | 'variantId' | 'variant' | 'size' | 'customSize'>) {
  return [
    item.productId,
    item.variantId || item.variant?.id || '',
    item.size || '',
    item.customSize ? JSON.stringify(item.customSize) : '',
  ].join('::');
}

function sameCartLine(item: CartItem, productId: string, variantId?: string, lineKey?: string) {
  return lineKey
    ? cartLineKey(item) === lineKey
    : item.productId === productId && (item.variantId || item.variant?.id) === variantId;
}

export function addToCart(cart: Cart, item: CartItem): Cart {
  const existingItem = cart.items.find((currentItem) => cartLineKey(currentItem) === cartLineKey(item));

  if (!existingItem) {
    return { ...cart, items: [...cart.items, item] };
  }

  return {
    ...cart,
    items: cart.items.map((currentItem) =>
      currentItem === existingItem
        ? { ...currentItem, quantity: Math.min(50, currentItem.quantity + item.quantity) }
        : currentItem
    ),
  };
}

export function removeFromCart(cart: Cart, productId: string, variantId?: string, lineKey?: string): Cart {
  return {
    ...cart,
    items: cart.items.filter((item) => !sameCartLine(item, productId, variantId, lineKey)),
  };
}

export function updateCartItemSize(cart: Cart, lineKey: string, size: string): Cart {
  const sourceIndex = cart.items.findIndex((item) => cartLineKey(item) === lineKey);
  if (sourceIndex < 0 || !size.trim()) return cart;

  const source = cart.items[sourceIndex];
  const updated: CartItem = {
    ...source,
    size,
    stock: source.sizeStock?.[size] ?? source.stock,
  };
  const updatedKey = cartLineKey(updated);
  const remaining = cart.items.filter((_, index) => index !== sourceIndex);
  const existingIndex = remaining.findIndex((item) => cartLineKey(item) === updatedKey);

  if (existingIndex >= 0) {
    const existing = remaining[existingIndex];
    remaining[existingIndex] = {
      ...existing,
      quantity: Math.min(50, existing.quantity + source.quantity),
    };
    return { ...cart, items: remaining };
  }

  remaining.splice(Math.min(sourceIndex, remaining.length), 0, updated);
  return { ...cart, items: remaining };
}
