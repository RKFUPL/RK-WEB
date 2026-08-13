export type ProductAvailability = 'in_stock' | 'custom_order' | 'sold_out';

export type CatalogProduct = {
  id: string;
  name?: string;
  sku?: string;
  status?: string;
  availability: ProductAvailability;
  price?: number;
  currency: 'INR';
  stock?: number;
  category?: string;
  description?: string;
  media: string[];
  attributes: {
    sizes?: string[];
    colors?: string[];
    color?: string;
    fabric?: string;
    occasion?: string;
    gender?: string;
    material?: string;
    customizationInformation?: string;
    [key: string]: unknown;
  };
  displayOrder?: number;
  collectionIds?: string[];
  isDummy?: boolean;
  updatedAt?: string;
  pricing?: {
    baseCurrency: 'INR';
    basePrice?: number;
    fxBufferPercent: number;
  };
};

export type ManagedCollection = {
  id: string;
  name: string;
  slug: string;
  status: string;
  description?: string;
  heroImage?: string;
  createdAt?: string;
  updatedAt?: string;
  productCount: number;
  products?: CatalogProduct[];
};

export const availabilityLabels: Record<ProductAvailability, string> = {
  in_stock: 'In Stock',
  custom_order: 'Custom Order',
  sold_out: 'Sold Out',
};

export const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});
