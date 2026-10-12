import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { adminMediaGroups, availableGalleryMedia, guardedMediaCleanupPlan, variantMediaSources, variantPrimaryAndHoverSources } from "./catalog.ts";

const drawer = readFileSync(new URL("../components/collections/collection-management-detail.tsx", import.meta.url), "utf8");
const editor = readFileSync(new URL("../components/collections/variant-media-editor.tsx", import.meta.url), "utf8");

const staleIds = [
  "54810cc923b41e35020f31db18aec929",
  "2bd1d35e3b960296cf9e11bed471c781",
  "c8b26e803882073a7b9306b87b4c04f5",
];
const redIds = [
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "cccccccccccccccccccccccccccccccc",
];

function t1Product() {
  return {
    id: "6ac91677140d396488cdc687",
    availability: "in_stock",
    currency: "INR",
    media: ["legacy-red-1", "legacy-red-2", "legacy-red-3"],
    variants: [
      { id: "colour:red", sku: "SK-T1-RED", colour: "Red", colourSlug: "red", status: "active", currency: "INR", images: [], sizes: [], sizeInventory: [] },
      { id: "colour:blue", sku: "SK-T1-BLUE", colour: "Blue", colourSlug: "blue", status: "active", currency: "INR", images: [], sizes: [], sizeInventory: [] },
    ],
    catalogMedia: [
      ...staleIds.map((media_id, position) => ({ media_id, provider: "zoho_workdrive", position, permalink: `https://workdrive.zoho.in/file/old-${position}` })),
      ...redIds.map((media_id, position) => ({ media_id, provider: "zoho_workdrive", variant_id: "colour:red", position, is_primary: position === 0, is_hover: position === 2, renderUrl: `/api/catalog/products/6ac91677140d396488cdc687/media/${media_id}` })),
    ],
  };
}

test("admin media counts keep Red, Blue and unassigned relationships separate", () => {
  const groups = adminMediaGroups(t1Product());
  assert.equal(groups.variants["colour:red"].length, 3);
  assert.equal(groups.variants["colour:blue"].length, 0);
  assert.equal(groups.unassigned.length, 3);
});

test("admin media counts update after one verified relationship removal", () => {
  const parentRemoved = t1Product();
  parentRemoved.catalogMedia = parentRemoved.catalogMedia.filter((item) => item.media_id !== staleIds[0]);
  let groups = adminMediaGroups(parentRemoved);
  assert.equal(groups.unassigned.length, 2);
  assert.equal(groups.variants["colour:red"].length, 3);
  assert.equal(groups.variants["colour:blue"].length, 0);

  const redRemoved = t1Product();
  redRemoved.catalogMedia = redRemoved.catalogMedia.filter((item) => item.media_id !== redIds[1]);
  groups = adminMediaGroups(redRemoved);
  assert.equal(groups.unassigned.length, 3);
  assert.equal(groups.variants["colour:red"].length, 2);
  assert.equal(groups.variants["colour:blue"].length, 0);
});

test("an empty Blue gallery does not inherit Red or parent-level media", () => {
  const product = t1Product();
  assert.deepEqual(variantMediaSources(product, product.variants[0]), [
    ...redIds.map((id) => `/api/catalog/products/6ac91677140d396488cdc687/media/${id}`),
  ]);
  assert.deepEqual(variantMediaSources(product, product.variants[1]), []);
  assert.deepEqual(variantPrimaryAndHoverSources(product, product.variants[0]), {
    primary: `/api/catalog/products/6ac91677140d396488cdc687/media/${redIds[0]}`,
    hover: `/api/catalog/products/6ac91677140d396488cdc687/media/${redIds[2]}`,
  });
});

test("WorkDrive media requires a persisted relationship and exact product-bound proxy", () => {
  const product = t1Product();
  product.catalogMedia = [
    { media_id: "colour:red:new:1:0", provider: "zoho_workdrive", variant_id: "colour:red", permalink: "https://workdrive.zoho.in/file/private", renderUrl: "/api/catalog/products/6ac91677140d396488cdc687/media/colour%3Ared%3Anew%3A1%3A0" },
    { media_id: redIds[0], provider: "zoho_workdrive", variant_id: "colour:red", permalink: "https://workdrive.zoho.in/file/private", renderUrl: "/api/catalog/products/another-product/media/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
  ];
  assert.deepEqual(variantMediaSources(product, product.variants[0]), []);
});

test("legacy product fallback uses safe structured parent media and removes duplicates", () => {
  const parentId = "dddddddddddddddddddddddddddddddd";
  const product = t1Product();
  product.variants = [{ ...product.variants[0], images: [], imageMeta: [] }];
  product.catalogMedia = [
    { media_id: parentId, provider: "zoho_workdrive", position: 0, renderUrl: `/api/catalog/products/${product.id}/media/${parentId}` },
    { media_id: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", provider: "cloudinary", position: 1, secure_url: "https://res.cloudinary.com/demo/image/upload/parent.jpg" },
  ];
  product.media = ["https://workdrive.zoho.in/file/private"];
  assert.deepEqual(variantMediaSources(product, product.variants[0]), [
    `/api/catalog/products/${product.id}/media/${parentId}`,
    "https://res.cloudinary.com/demo/image/upload/parent.jpg",
  ]);
});

test("failed images are removed without leaking another colour or duplicating sources", () => {
  const red = redIds.map((id) => `/api/catalog/products/6ac91677140d396488cdc687/media/${id}`);
  assert.deepEqual(availableGalleryMedia([...red, red[0]], [red[1]]), [red[0], red[2]]);
  assert.deepEqual(availableGalleryMedia([], red), []);
});

test("variant gallery places the configured primary image first", () => {
  const product = t1Product();
  product.catalogMedia = product.catalogMedia
    .filter((item) => item.variant_id === "colour:red")
    .map((item, index) => ({ ...item, is_primary: index === 1 }));
  assert.equal(
    variantMediaSources(product, product.variants[0])[0],
    `/api/catalog/products/${product.id}/media/${redIds[1]}`,
  );
});

test("guarded cleanup requires the exact unassigned set and retains variant media", () => {
  const product = t1Product();
  assert.deepEqual(guardedMediaCleanupPlan(product, product.id, new Set(staleIds)), []);
  assert.equal(guardedMediaCleanupPlan(product, product.id, new Set([...staleIds, "unexpected"])), null);
  assert.equal(product.catalogMedia.filter((item) => item.variant_id === "colour:red").length, 3);
});

test("admin overview and gallery use authenticated persisted-media previews", () => {
  assert.match(drawer, /api\/staff\/products\/\$\{encodeURIComponent\(product\.id\)\}\/media/);
  assert.doesNotMatch(drawer, /src=\{product\.media\[0\]\}/);
  assert.match(editor, /item\.renderUrl \|\| `\/api\/staff\/products/);
  assert.match(editor, /Unsaved image relationship/);
  assert.match(editor, /Preview unavailable/);
});
