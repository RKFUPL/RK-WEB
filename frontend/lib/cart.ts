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

export function addToCart(cart: Cart, item: CartItem): Cart {
  const limited = item.availability?.toLowerCase().replaceAll(' ', '_') === 'in_stock' && item.stock !== undefined;
  if (limited && (item.stock ?? 0) <= 0) return cart;
  const existingItem = cart.items.find(
    (currentItem) =>
      currentItem.productId === item.productId && currentItem.variant?.id === item.variant?.id
  );

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

export function removeFromCart(cart: Cart, productId: string, variantId?: string): Cart {
  return {
    ...cart,
    items: cart.items.filter(
      (item) => !(item.productId === productId && item.variant?.id === variantId)
    ),
  };
}
