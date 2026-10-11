import test from "node:test";
import assert from "node:assert/strict";

import {
  buildProductUpdate,
  productDraftFrom,
  productUpdateMismatch,
  verifyMediaRelationshipRemoval,
  verifyProductReadBack,
} from "./product-editor.ts";

const product = {
  id: "product-1",
  name: "T1",
  sku: "T1",
  price: 101,
  availability: "in_stock",
  category: "Couture",
  description: "Original",
  stock: 4,
  media: ["/api/catalog/products/product-1/media/media-1"],
  catalogMedia: [{ media_id: "media-1", provider: "zoho_workdrive", variant_id: "colour:red" }],
  attributes: {
    sizes: ["M", "XL"],
    colors: ["red", "blue"],
    fabric: "Silk",
    occasion: "Evening",
    gender: "Women",
    material: "Silk",
    customizationInformation: "Available",
  },
  sizeInventoryConfigured: true,
  sizeInventory: [
    { size: "M", stock: 3, enabled: true },
    { size: "XL", stock: 1, enabled: true },
  ],
};

test("product editor emits only changed product fields and never stock, SKU or media", () => {
  const draft = productDraftFrom(product);
  draft.name = "T1 Revised";
  draft.price = "125";
  const { payload, error } = buildProductUpdate(product, draft);

  assert.equal(error, undefined);
  assert.deepEqual(payload, { name: "T1 Revised", price: 125 });
  assert.equal("stock" in payload, false);
  assert.equal("sku" in payload, false);
  assert.equal("media" in payload, false);
});

test("descriptive edits preserve unrelated attributes and existing size quantities", () => {
  const draft = productDraftFrom(product);
  draft.fabric = "Cotton silk";
  draft.sizes = "m, xl";
  const { payload } = buildProductUpdate(product, draft);

  assert.equal(payload.sizeInventory, undefined);
  assert.deepEqual(payload.attributes, {
    ...product.attributes,
    sizes: ["M", "XL"],
    colors: ["red", "blue"],
    fabric: "Cotton silk",
    occasion: "Evening",
    gender: "Women",
    material: "Silk",
    customizationInformation: "Available",
  });
});

test("availability updates do not include inventory quantities", () => {
  const draft = productDraftFrom(product);
  draft.availability = "custom_order";
  assert.deepEqual(buildProductUpdate(product, draft).payload, { availability: "custom_order" });
});

test("fresh read-back mismatch identifies the field that was not persisted", () => {
  const stale = { ...product };
  assert.equal(productUpdateMismatch(stale, { name: "T1 Revised" }), "product name");
  assert.equal(productUpdateMismatch({ ...stale, name: "T1 Revised" }, { name: "T1 Revised" }), null);
});

test("read-back retries a transient unavailable GET without repeating the save", async () => {
  const stored = { ...product, name: "T1 Revised" };
  let reads = 0;
  const result = await verifyProductReadBack(async () => {
    reads += 1;
    return reads === 1 ? undefined : stored;
  }, { name: "T1 Revised" });
  assert.equal(reads, 2);
  assert.equal(result.status, "verified");
});

test("read-back distinguishes unavailable verification from a persistence mismatch", async () => {
  let reads = 0;
  const unavailable = await verifyProductReadBack(async () => {
    reads += 1;
    return undefined;
  }, { name: "T1 Revised" });
  assert.equal(reads, 2);
  assert.deepEqual(unavailable, { status: "unavailable" });

  const mismatch = await verifyProductReadBack(
    async () => ({ ...product, name: "T1" }),
    { name: "T1 Revised" },
  );
  assert.deepEqual(mismatch, { status: "mismatch", field: "product name" });
});

test("single media removal is successful only after a fresh response omits that relationship", async () => {
  const afterRemoval = {
    ...product,
    catalogMedia: [
      { media_id: "parent-2", provider: "zoho_workdrive" },
      { media_id: "red-1", provider: "zoho_workdrive", variant_id: "colour:red" },
      { media_id: "red-2", provider: "zoho_workdrive", variant_id: "colour:red" },
    ],
    variants: [
      { id: "colour:red", imageMeta: [{ id: "red-source-1" }, { id: "red-source-2" }] },
      { id: "colour:blue", imageMeta: [] },
    ],
  };
  const result = await verifyMediaRelationshipRemoval(async () => afterRemoval, "parent-1");
  assert.equal(result.status, "verified");
  assert.equal(afterRemoval.catalogMedia.filter((item) => !item.variant_id).length, 1);
  assert.equal(afterRemoval.catalogMedia.filter((item) => item.variant_id === "colour:red").length, 2);
  assert.equal(afterRemoval.variants[1].imageMeta.length, 0);
});

test("failed or stale media read-back never reports false removal success", async () => {
  const unavailable = await verifyMediaRelationshipRemoval(async () => undefined, "media-1");
  assert.deepEqual(unavailable, { status: "unavailable" });
  const stale = await verifyMediaRelationshipRemoval(async () => product, "media-1");
  assert.deepEqual(stale, { status: "mismatch" });
});

test("invalid price is rejected before any request payload is produced", () => {
  const draft = productDraftFrom(product);
  draft.price = "not-a-price";
  const result = buildProductUpdate(product, draft);
  assert.match(result.error, /non-negative number/i);
  assert.deepEqual(result.payload, {});
});
