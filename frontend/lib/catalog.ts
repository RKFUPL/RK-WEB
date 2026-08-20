export type ProductAvailability = 'in_stock' | 'custom_order' | 'sold_out';
export type ProductVariantStatus = 'active' | 'inactive' | 'remove';

export type CatalogProductVariant = {
  id: string;
  sku: string;
  colour: string;
  colourSlug: string;
  images: string[];
  status: ProductVariantStatus;
  price?: number;
  currency: 'INR';
  stock?: number;
  sizes: string[];
  sizeInventory: Array<{ size: string; stock: number; enabled?: boolean }>;
  metadata?: Record<string, unknown>;
};
export type CollectionHeroType = 'image' | 'video';
export type CollectionHeroLayout = 'full_bleed' | 'editorial_split' | 'media_dominant';
export type CollectionHeroTextPosition = 'left' | 'right';
export type CollectionHeroTextTheme = 'light' | 'dark';
export type CollectionHeroTitleScale = 'standard' | 'feature';

export type CollectionHeroConfig = {
  type: CollectionHeroType;
  image: string;
  video: string;
  poster: string;
  mobileImage: string;
  mobileVideo: string;
  layout: CollectionHeroLayout;
  label: string;
  ctaLabel: string;
  desktopObjectPosition?: string;
  mobileObjectPosition?: string;
  textPosition?: CollectionHeroTextPosition;
  textTheme?: CollectionHeroTextTheme;
  titleScale?: CollectionHeroTitleScale;
};

export type CatalogProduct = {
  id: string;
  name?: string;
  productCode?: string;
  parentSku?: string;
  skuPrefix?: string;
  sku?: string;
  slug?: string;
  status?: string;
  availability: ProductAvailability;
  price?: number;
  currency: 'INR';
  stock?: number;
  sizeSystemEnabled?: boolean;
  sizeInventoryConfigured?: boolean;
  sizeInventory?: Array<{ size: string; stock: number; enabled?: boolean }>;
  unallocatedStock?: number;
  customSizeConfig?: { enabled?: boolean; fields?: string[]; label?: string; unit?: 'cm' | 'in' };
  taxInclusive?: boolean;
  mrpIncludesGst?: boolean;
  category?: string;
  description?: string;
  media: string[];
  variants?: CatalogProductVariant[];
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
  createdAt?: string;
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
  collectionType?: 'standard' | 'runway';
  taxInclusive?: boolean;
  description?: string;
  heroImage?: string;
  hero?: CollectionHeroConfig;
  season?: string;
  year?: number;
  designerNote?: string;
  collectionNumber?: string;
  location?: string;
  campaignInformation?: string;
  createdAt?: string;
  updatedAt?: string;
  productCount: number;
  products?: CatalogProduct[];
};

export const availabilityLabels: Record<ProductAvailability, string> = {
  in_stock: 'IN STOCK',
  custom_order: 'CUSTOM ORDER',
  sold_out: 'NO STOCK',
};

export const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});
