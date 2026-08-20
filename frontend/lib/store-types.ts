/**
 * Commerce foundation. These types are intentionally UI- and backend-agnostic
 * so they can later be connected to authentication, a CMS, and checkout.
 */
export type ProductVariant = {
  id: string;
  sku: string;
  colour: string;
  name: string;
  value: string;
  status: 'active' | 'inactive';
};

export type CartItem = {
  productId: string;
  productCode: string;
  variantId: string;
  sku: string;
  collection: string;
  colour: string;
  name: string;
  price: number;
  quantity: number;
  image?: string;
  stock?: number;
  availability?: string;
  /** Explicitly distinguishes legacy product stock from size stock. */
  inventoryMode?: 'legacy' | 'size' | 'variant';
  /** Distinguishes a standard-size purchase from a submitted custom-size order. */
  purchaseMode?: 'standard_size' | 'custom_size';
  variant?: ProductVariant;
  /** Optional size selection. Kept separate from color/other variants. */
  size?: string;
  /** Sizes and per-size stock copied from the product at add-to-bag time. */
  sizeOptions?: string[];
  sizeStock?: Record<string, number>;
  customSize?: {
    unit: 'cm' | 'in';
    measurements: Record<string, string>;
  };
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
