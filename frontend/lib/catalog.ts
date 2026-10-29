export type ProductAvailability = "in_stock" | "custom_order" | "sold_out";
export type ProductVariantStatus = "active" | "inactive" | "remove";

export function normalizeColour(value: unknown): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
}

export function productColours(product: Pick<CatalogProduct, 'attributes' | 'variants'>): string[] {
  const variants = product.variants || [];
  const variantValues = variants
    .filter((variant) => variant.status === 'active')
    .map((variant) => variant.colour)
    .filter(Boolean);
  // Once variant records exist, their status is authoritative. Falling back
  // to attributes here would resurrect a colour whose variant was removed.
  const values = variants.length
    ? variantValues
    : product.attributes?.colors ?? (product.attributes?.color ? [String(product.attributes.color)] : []);
  return [...new Set(values.map(normalizeColour).filter(Boolean))];
}

export function productHasColour(product: Pick<CatalogProduct, 'attributes' | 'variants'>, colour: unknown): boolean {
  const wanted = normalizeColour(colour);
  return !wanted || productColours(product).includes(wanted);
}

export type CatalogProductVariant = {
  id: string;
  sku: string;
  colour: string;
  colourSlug: string;
  images: string[];
  imageMeta?: Array<{ id?: string; permalink?: string; renderUrl?: string; alt_text?: string; is_primary?: boolean; is_hover?: boolean; position?: number }>;
  status: ProductVariantStatus;
  price?: number;
  priceMode?: "inherit" | "override";
  currency: "INR";
  stock?: number;
  sizes: string[];
  sizeInventory: Array<{ size: string; stock: number; enabled?: boolean }>;
  metadata?: Record<string, unknown>;
};
export type CollectionHeroType = "image" | "video";
export type CollectionHeroLayout =
  "full_bleed" | "editorial_split" | "media_dominant";
export type CollectionHeroTextPosition = "left" | "right";
export type CollectionHeroTextTheme = "light" | "dark";
export type CollectionHeroTitleScale = "standard" | "feature";

export type CatalogMedia = {
  id?: string;
  media_id: string;
  variant_id?: string;
  colour_slug?: string;
  colour?: string;
  provider: "cloudinary" | "zoho_workdrive";
  owner_system?: "rk-web" | "rk-stock";
  public_id?: string;
  permalink?: string;
  secure_url?: string;
  url?: string;
  position?: number;
  is_primary?: boolean;
  is_hover?: boolean;
  alt_text?: string;
  description?: string;
  renderUrl?: string;
};

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
  images?: Array<{
    id: string;
    image: string;
    mobileImage?: string;
    alt?: string;
    desktopObjectPosition?: string;
    mobileObjectPosition?: string;
    position?: number;
  }>;
};

export type CatalogProduct = {
  id: string;
  name?: string;
  styleCode?: string;
  style?: string;
  productCode?: string;
  parentSku?: string;
  skuPrefix?: string;
  sku?: string;
  slug?: string;
  status?: string;
  availability: ProductAvailability;
  price?: number;
  currency: "INR";
  stock?: number;
  sizeSystemEnabled?: boolean;
  sizeInventoryConfigured?: boolean;
  sizeInventory?: Array<{ size: string; stock: number; enabled?: boolean }>;
  unallocatedStock?: number;
  customSizeConfig?: {
    enabled?: boolean;
    fields?: string[];
    label?: string;
    unit?: "cm" | "in";
  };
  taxInclusive?: boolean;
  mrpIncludesGst?: boolean;
  category?: string;
  description?: string;
  media: string[];
  catalogMedia?: CatalogMedia[];
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
    baseCurrency: "INR";
    basePrice?: number;
    fxBufferPercent: number;
  };
};

function uniqueMediaSources(values: Array<string | undefined>) {
  const seen = new Set<string>();
  return values.filter((value): value is string => {
    const source = String(value || "").trim();
    if (!source || seen.has(source)) return false;
    seen.add(source);
    return true;
  });
}

function isPersistedRelationshipId(value: unknown) {
  return /^[a-f0-9]{24,64}$/i.test(String(value || "")) || /^[0-9a-f-]{36}$/i.test(String(value || ""));
}

function safeLegacyImageSource(value: unknown) {
  const source = String(value || "").trim();
  if (!source || /workdrive\.zoho(?:external)?\.in/i.test(source)) return undefined;
  if (source.startsWith("/") && !source.startsWith("//")) return source;
  try {
    const parsed = new URL(source);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password ? source : undefined;
  } catch {
    return undefined;
  }
}

function catalogMediaSource(product: CatalogProduct, item: CatalogMedia) {
  const relationshipId = String(item.media_id || item.id || "").trim();
  if (item.provider === "zoho_workdrive") {
    if (!isPersistedRelationshipId(relationshipId)) return undefined;
    const expected = `/api/catalog/products/${encodeURIComponent(product.id)}/media/${encodeURIComponent(relationshipId)}`;
    const renderUrl = String(item.renderUrl || "");
    return renderUrl === expected || new RegExp(`^${expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\?v=[a-f0-9]{16}$`, "i").test(renderUrl)
      ? renderUrl
      : undefined;
  }
  return safeLegacyImageSource(item.renderUrl || item.secure_url || item.url || item.permalink);
}

function mediaPosition(item: CatalogMedia) {
  const position = Number(item.position ?? 0);
  return Number.isFinite(position) ? position : 0;
}

function orderedMedia(items: CatalogMedia[]) {
  return [...items].sort((a, b) => mediaPosition(a) - mediaPosition(b) || String(a.media_id || a.id || '').localeCompare(String(b.media_id || b.id || '')));
}

/** Resolve only browser-safe media for the selected colour gallery. */
export function variantMediaSources(product: CatalogProduct, variant?: CatalogProductVariant): string[] {
  const structured = orderedMedia((product.catalogMedia || [])
    .filter((item) => variant ? String(item.variant_id || "") === variant.id : !item.variant_id));
  if (structured.length) {
    const resolved = uniqueMediaSources(structured.map((item) => catalogMediaSource(product, item)));
    if (resolved.length) return resolved;
  }
  if (!variant) return uniqueMediaSources((product.media || []).map(safeLegacyImageSource));
  const legacyVariantImages = uniqueMediaSources((variant.images || []).map(safeLegacyImageSource));
  if (legacyVariantImages.length) return legacyVariantImages;
  const hasAnyVariantGallery = (product.catalogMedia || []).some((item) => Boolean(item.variant_id))
    || (product.variants || []).some((item) => Boolean(item.images?.length || item.imageMeta?.length));
  if (hasAnyVariantGallery) return [];
  const parentStructured = orderedMedia((product.catalogMedia || []).filter((item) => !item.variant_id));
  const parentResolved = uniqueMediaSources(parentStructured.map((item) => catalogMediaSource(product, item)));
  return parentResolved.length ? parentResolved : uniqueMediaSources((product.media || []).map(safeLegacyImageSource));
}

export function availableGalleryMedia(sources: string[], failedSources: Iterable<string>) {
  const failed = new Set(failedSources);
  return uniqueMediaSources(sources).filter((source) => !failed.has(source));
}

export function variantPrimaryAndHoverSources(product: CatalogProduct, variant?: CatalogProductVariant) {
  const sources = variantMediaSources(product, variant);
  if (!variant || !sources.length) return { primary: sources[0], hover: undefined };
  const structured = (product.catalogMedia || []).filter((item) => item.variant_id === variant.id);
  const metadata = Array.isArray(variant.imageMeta) ? variant.imageMeta : [];
  const byIdentity = (entry: { id?: string; media_id?: string; permalink?: string; renderUrl?: string }) => structured.find((item) => {
    const itemIdentity = String(item.media_id || item.id || item.permalink || item.renderUrl || "");
    const entryIdentity = String(entry.media_id || entry.id || entry.permalink || entry.renderUrl || "");
    return Boolean(entryIdentity) && itemIdentity === entryIdentity;
  });
  const primaryRecord = structured.find((item) => item.is_primary || (item as CatalogMedia & { is_main?: boolean }).is_main)
    || metadata.find((item) => item.is_primary && byIdentity(item)) && byIdentity(metadata.find((item) => item.is_primary)!)
    || structured[0];
  const hoverRecord = structured.find((item) => item.is_hover)
    || metadata.find((item) => item.is_hover && byIdentity(item)) && byIdentity(metadata.find((item) => item.is_hover)!)
    || undefined;
  const safeSource = (item?: CatalogMedia) => item ? catalogMediaSource(product, item) : undefined;
  const primary = safeSource(primaryRecord) || sources[0];
  const hover = safeSource(hoverRecord);
  return { primary, hover: hover && hover !== primary ? hover : undefined };
}

export function productVariantHref(href: string, variantId?: string) {
  if (!variantId) return href;
  const separator = href.includes("?") ? "&" : "?";
  return `${href}${separator}variant=${encodeURIComponent(variantId)}`;
}

export type AdminMediaEntry = {
  identity: string;
  permalink: string;
  label: string;
  variantId?: string;
};

function mediaIdentity(item: CatalogMedia, fallback: string) {
  return String(item.media_id || item.id || item.renderUrl || item.permalink || item.secure_url || item.url || fallback);
}

export function adminMediaGroups(product: CatalogProduct) {
  const structured = Array.isArray(product.catalogMedia) ? product.catalogMedia : [];
  const unassigned: AdminMediaEntry[] = [];
  const activeVariants = (product.variants || []).filter((variant) => String(variant.status || "").toLowerCase() !== "remove");
  const activeVariantIds = new Set(activeVariants.map((variant) => variant.id));
  const variants: Record<string, AdminMediaEntry[]> = Object.fromEntries(activeVariants.map((variant) => [variant.id, []]));
  const seen = new Set<string>();
  structured.forEach((item, index) => {
    const identity = mediaIdentity(item, `catalog:${index}`);
    if (seen.has(identity)) return;
    seen.add(identity);
    const entry = {
      identity,
      permalink: String(item.permalink || item.secure_url || item.url || item.renderUrl || "").trim(),
      label: String(item.alt_text || item.description || item.colour || "").trim(),
      variantId: item.variant_id,
    };
    if (item.variant_id && activeVariantIds.has(item.variant_id)) (variants[item.variant_id] ||= []).push(entry);
    else unassigned.push(entry);
  });
  activeVariants.forEach((variant) => {
    if ((variants[variant.id] || []).length) return;
    const metadata = variant.imageMeta || [];
    const sources: Array<{ id?: string; permalink?: string; renderUrl?: string }> = metadata.length
      ? metadata
      : (variant.images || []).map((permalink) => ({ permalink }));
    sources.forEach((item, index) => {
      const permalink = String(item.permalink || item.renderUrl || "").trim();
      const identity = String(item.id || `${variant.id}:${index}:${permalink}`);
      if (!permalink || seen.has(identity)) return;
      seen.add(identity);
      (variants[variant.id] ||= []).push({ identity, permalink, label: variant.colour || "", variantId: variant.id });
    });
  });
  if (!structured.length && !Object.values(variants).some((items) => items.length)) {
    (product.media || []).forEach((permalink, index) => unassigned.push({ identity: `legacy:${index}:${permalink}`, permalink, label: "" }));
  }
  return { unassigned, variants };
}

export function guardedMediaCleanupPlan(product: CatalogProduct, productId: string, expectedIds: Set<string>) {
  if (product.id !== productId) return null;
  const structured = product.catalogMedia || [];
  const unassigned = structured.filter((item) => !item.variant_id);
  const actual = new Set(unassigned.map((item) => String(item.media_id || item.id || "")));
  if (unassigned.length !== expectedIds.size || actual.size !== expectedIds.size || [...expectedIds].some((id) => !actual.has(id))) return null;
  return unassigned.filter((item) => !expectedIds.has(String(item.media_id || item.id || "")));
}

export type ManagedCollection = {
  id: string;
  name: string;
  slug: string;
  status: string;
  collectionType?: "standard" | "runway";
  taxInclusive?: boolean;
  description?: string;
  coverImage?: string;
  coverImageSource?: string;
  heroImage?: string;
  hero?: CollectionHeroConfig;
  heroSource?: CollectionHeroConfig;
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
  in_stock: "IN STOCK",
  custom_order: "CUSTOM ORDER",
  sold_out: "NO STOCK",
};

export const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});
