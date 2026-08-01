/**
 * Commerce foundation. These types are intentionally UI- and backend-agnostic
 * so they can later be connected to authentication, a CMS, and checkout.
 */
export type ProductVariant = {
  id: string;
  name: string;
  value: string;
};

export type CartItem = {
  productId: string;
  name: string;
  price: number;
  quantity: number;
  image?: string;
  variant?: ProductVariant;
};

export type Cart = {
  items: CartItem[];
  currency: 'INR';
};

export type UserProfile = {
  id: string;
  email: string;
  displayName?: string;
  phone?: string;
  gender?: 'female' | 'male' | 'non-binary' | 'prefer-not-to-say';
  defaultAddressId?: string;
};

export type SavedAddress = {
  id: string;
  label: string;
  fullName: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
};

export type WishlistItem = {
  productId: string;
  addedAt: string;
};
