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

export function cartLineKey(item: Pick<CartItem, 'productId' | 'variant' | 'size' | 'customSize'>) {
  return [
    item.productId,
    item.variant?.id || '',
    item.size || '',
    item.customSize ? JSON.stringify(item.customSize) : '',
  ].join('::');
}

function sameCartLine(item: CartItem, productId: string, variantId?: string, lineKey?: string) {
  return lineKey
    ? cartLineKey(item) === lineKey
    : item.productId === productId && item.variant?.id === variantId;
}

export function addToCart(cart: Cart, item: CartItem): Cart {
  const limited = item.availability?.toLowerCase().replaceAll(' ', '_') === 'in_stock' && item.stock !== undefined;
  if (limited && (item.stock ?? 0) <= 0) return cart;
  const existingItem = cart.items.find((currentItem) => cartLineKey(currentItem) === cartLineKey(item));

  if (!existingItem) {
    return { ...cart, items: [...cart.items, item] };
  }

  return {
    ...cart,
    items: cart.items.map((currentItem) =>
      currentItem === existingItem
        ? { ...currentItem, quantity: limited ? Math.min(currentItem.quantity + item.quantity, item.stock ?? currentItem.quantity + item.quantity) : currentItem.quantity + item.quantity }
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
    variant: source.variant?.name === 'Size'
      ? { ...source.variant, id: `size:${size}`, value: size }
      : source.variant,
  };
  const updatedKey = cartLineKey(updated);
  const remaining = cart.items.filter((_, index) => index !== sourceIndex);
  const existingIndex = remaining.findIndex((item) => cartLineKey(item) === updatedKey);

  if (existingIndex >= 0) {
    const existing = remaining[existingIndex];
    const limited = existing.availability?.toLowerCase().replaceAll(' ', '_') === 'in_stock' && existing.stock !== undefined;
    remaining[existingIndex] = {
      ...existing,
      quantity: limited ? Math.min(existing.quantity + source.quantity, existing.stock ?? existing.quantity + source.quantity) : existing.quantity + source.quantity,
    };
    return { ...cart, items: remaining };
  }

  remaining.splice(Math.min(sourceIndex, remaining.length), 0, updated);
  return { ...cart, items: remaining };
}
