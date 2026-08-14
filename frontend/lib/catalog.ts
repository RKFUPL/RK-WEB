export type ProductAvailability = 'in_stock' | 'custom_order' | 'sold_out';
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
  sku?: string;
  slug?: string;
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
  in_stock: 'In Stock',
  custom_order: 'Custom Order',
  sold_out: 'Sold Out',
};

export const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});
