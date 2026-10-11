import type { CatalogProduct, ProductAvailability } from "./catalog";

export type ProductDraft = {
  name: string;
  price: string;
  availability: ProductAvailability;
  category: string;
  description: string;
  sizes: string;
  colors: string;
  fabric: string;
  occasion: string;
  gender: string;
  material: string;
  customizationInformation: string;
};

const canonicalSizes = ["XS", "S", "M", "L", "XL"];
const attributeKeys = [
  "sizes",
  "colors",
  "fabric",
  "occasion",
  "gender",
  "material",
  "customizationInformation",
] as const;

function text(value: unknown) {
  return String(value ?? "").trim();
}

function list(value: string, upper = false) {
  const seen = new Set<string>();
  return value
    .split(",")
    .map((entry) => text(entry))
    .filter(Boolean)
    .map((entry) => (upper ? entry.toUpperCase() : entry))
    .filter((entry) => !seen.has(entry.toLocaleLowerCase()) && Boolean(seen.add(entry.toLocaleLowerCase())));
}

export function productDraftFrom(product: CatalogProduct): ProductDraft {
  const attributes = product.attributes || {};
  return {
    name: text(product.name),
    price: product.price === null || product.price === undefined ? "" : String(product.price),
    availability: product.availability,
    category: text(product.category),
    description: text(product.description),
    sizes: Array.isArray(attributes.sizes) ? attributes.sizes.join(", ") : "",
    colors: Array.isArray(attributes.colors) ? attributes.colors.join(", ") : "",
    fabric: text(attributes.fabric),
    occasion: text(attributes.occasion),
    gender: text(attributes.gender),
    material: text(attributes.material),
    customizationInformation: text(attributes.customizationInformation),
  };
}

function normalisedDraft(draft: ProductDraft) {
  return {
    ...draft,
    name: text(draft.name),
    category: text(draft.category),
    description: text(draft.description),
    sizes: list(draft.sizes, true),
    colors: list(draft.colors),
    fabric: text(draft.fabric),
    occasion: text(draft.occasion),
    gender: text(draft.gender),
    material: text(draft.material),
    customizationInformation: text(draft.customizationInformation),
  };
}

export function buildProductUpdate(
  baseline: CatalogProduct,
  draft: ProductDraft,
): { payload: Record<string, unknown>; error?: string } {
  const current = normalisedDraft(productDraftFrom(baseline));
  const next = normalisedDraft(draft);
  const payload: Record<string, unknown> = {};
  const price = draft.price.trim() === "" ? null : Number(draft.price);

  if (!next.name) return { payload, error: "Product name is required." };
  if (price !== null && (!Number.isFinite(price) || price < 0)) {
    return { payload, error: "Base price must be a non-negative number." };
  }
  if (next.sizes.some((size) => !canonicalSizes.includes(size))) {
    return { payload, error: "Sizes must use XS, S, M, L or XL." };
  }

  if (next.name !== current.name) payload.name = next.name;
  if (price !== (baseline.price ?? null)) payload.price = price;
  if (draft.availability !== baseline.availability) payload.availability = draft.availability;
  if (next.category !== current.category) payload.category = next.category;
  if (next.description !== current.description) payload.description = next.description;

  const attributesChanged = attributeKeys.some((key) => {
    if (key === "sizes" || key === "colors") {
      return JSON.stringify(next[key]) !== JSON.stringify(current[key]);
    }
    return next[key] !== current[key];
  });
  if (attributesChanged) {
    payload.attributes = {
      ...(baseline.attributes || {}),
      sizes: next.sizes,
      colors: next.colors,
      fabric: next.fabric,
      occasion: next.occasion,
      gender: next.gender,
      material: next.material,
      customizationInformation: next.customizationInformation,
    };
  }

  if (JSON.stringify(next.sizes) !== JSON.stringify(current.sizes)) {
    const existing = new Map(
      (baseline.sizeInventory || []).map((entry) => [entry.size.toUpperCase(), entry]),
    );
    payload.sizeInventoryConfigured = next.sizes.length > 0;
    payload.sizeInventory = next.sizes.map((size) => ({
      size,
      stock: Number(existing.get(size)?.stock || 0),
      enabled: existing.get(size)?.enabled !== false,
    }));
  }
  return { payload };
}

export function productUpdateMismatch(
  persisted: CatalogProduct | undefined,
  payload: Record<string, unknown>,
) {
  if (!persisted) return "product";
  if ("name" in payload && text(persisted.name) !== payload.name) return "product name";
  if ("price" in payload && (persisted.price ?? null) !== payload.price) return "base price";
  if ("availability" in payload && persisted.availability !== payload.availability) return "availability";
  if ("category" in payload && text(persisted.category) !== payload.category) return "category";
  if ("description" in payload && text(persisted.description) !== payload.description) return "description";
  if ("attributes" in payload) {
    const expected = payload.attributes as Record<string, unknown>;
    for (const key of attributeKeys) {
      if (JSON.stringify(persisted.attributes?.[key] ?? (key === "sizes" || key === "colors" ? [] : "")) !== JSON.stringify(expected[key])) {
        return key;
      }
    }
  }
  if ("sizeInventory" in payload && JSON.stringify(persisted.sizeInventory || []) !== JSON.stringify(payload.sizeInventory)) {
    return "size inventory";
  }
  return null;
}

export type ProductReadBackResult =
  | { status: "verified"; product: CatalogProduct }
  | { status: "unavailable" }
  | { status: "mismatch"; field: string };

export async function verifyProductReadBack(
  read: () => Promise<CatalogProduct | undefined>,
  payload: Record<string, unknown>,
  attempts = 2,
): Promise<ProductReadBackResult> {
  const boundedAttempts = Math.max(1, Math.min(3, Math.trunc(attempts) || 1));
  for (let attempt = 0; attempt < boundedAttempts; attempt += 1) {
    let product: CatalogProduct | undefined;
    try {
      product = await read();
    } catch {
      product = undefined;
    }
    if (!product) continue;
    const mismatch = productUpdateMismatch(product, payload);
    return mismatch
      ? { status: "mismatch", field: mismatch }
      : { status: "verified", product };
  }
  return { status: "unavailable" };
}

export type MediaRemovalReadBackResult =
  | { status: "verified"; product: CatalogProduct }
  | { status: "unavailable" }
  | { status: "mismatch" };

function productHasMediaRelationship(product: CatalogProduct, mediaId: string) {
  if ((product.catalogMedia || []).some((item) => String(item.media_id || item.id || "") === mediaId)) return true;
  return (product.variants || []).some((variant) =>
    (variant.imageMeta || []).some((item) => String(item.id || "") === mediaId),
  );
}

export async function verifyMediaRelationshipRemoval(
  read: () => Promise<CatalogProduct | undefined>,
  mediaId: string,
  attempts = 2,
): Promise<MediaRemovalReadBackResult> {
  const boundedAttempts = Math.max(1, Math.min(3, Math.trunc(attempts) || 1));
  for (let attempt = 0; attempt < boundedAttempts; attempt += 1) {
    let product: CatalogProduct | undefined;
    try {
      product = await read();
    } catch {
      product = undefined;
    }
    if (!product) continue;
    return productHasMediaRelationship(product, mediaId)
      ? { status: "mismatch" }
      : { status: "verified", product };
  }
  return { status: "unavailable" };
}
