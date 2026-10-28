import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { adminMediaGroups, availableGalleryMedia, guardedMediaCleanupPlan, productColours, productHasColour, productVariantHref, variantMediaSources, variantPrimaryAndHoverSources } from "./catalog.ts";

const drawer = readFileSync(new URL("../components/collections/collection-management-detail.tsx", import.meta.url), "utf8");
const editor = readFileSync(new URL("../components/collections/variant-media-editor.tsx", import.meta.url), "utf8");
const card = readFileSync(new URL("../components/collections/collection-product-card.tsx", import.meta.url), "utf8");
const collectionProducts = readFileSync(new URL("../components/collections/storefront-collection-products.tsx", import.meta.url), "utf8");
const productDetail = readFileSync(new URL("../components/products/product-detail-page.tsx", import.meta.url), "utf8");
const productRoute = readFileSync(new URL("../app/products/[id]/page.tsx", import.meta.url), "utf8");

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

test("removed colours leave retained media counted as unassigned, not as active colour counts", () => {
  const product = t1Product();
  product.variants[0].status = "remove";
  const groups = adminMediaGroups(product);
  assert.equal(groups.variants["colour:red"], undefined);
  assert.equal(groups.unassigned.length, 6);
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

test("variant gallery keeps saved order while resolving the configured primary image", () => {
  const product = t1Product();
  product.catalogMedia = product.catalogMedia
    .filter((item) => item.variant_id === "colour:red")
    .map((item, index) => ({ ...item, is_primary: index === 1 }));
  assert.equal(
    variantMediaSources(product, product.variants[0])[0],
    `/api/catalog/products/${product.id}/media/${redIds[0]}`,
  );
  assert.equal(variantPrimaryAndHoverSources(product, product.variants[0]).primary, `/api/catalog/products/${product.id}/media/${redIds[1]}`);
});

test("variant primary and hover metadata remain authoritative when catalog flags use legacy is_main", () => {
  const product = t1Product();
  product.catalogMedia = product.catalogMedia
    .filter((item) => item.variant_id === "colour:red")
    .map((item, index) => ({ ...item, is_primary: false, is_main: index === 2, is_hover: index === 1 }));
  product.variants[0].imageMeta = product.catalogMedia.map((item, index) => ({
    id: item.media_id,
    permalink: item.permalink,
    is_primary: index === 2,
    is_hover: index === 1,
  }));
  const resolved = variantPrimaryAndHoverSources(product, product.variants[0]);
  assert.equal(resolved.primary, `/api/catalog/products/${product.id}/media/${redIds[2]}`);
  assert.equal(resolved.hover, `/api/catalog/products/${product.id}/media/${redIds[1]}`);
});

test("collection cards expose a variant-aware accessible colour selector", () => {
  assert.match(card, /selectableVariants\.length > 1/);
  assert.match(card, /variant\.status !== 'active'/);
  assert.match(card, /aria-haspopup="menu"/);
  assert.match(card, /role="menuitemradio"/);
  assert.match(card, /hiddenColourCount/);
  assert.match(card, /pointerdown/);
  assert.match(card, /event\.key === 'Escape'/);
  assert.match(card, /setSelectedVariantId\(variant\.id\)/);
  assert.match(card, /variantPrimaryAndHoverSources\(product, selectedVariant\)/);
  assert.match(card, /selectedVariant\?\.colour \|\| productColours/);
  assert.doesNotMatch(card, /window\.location\.assign/);
});

test("versioned WorkDrive proxy URLs remain product-bound and reject invalid versions", () => {
  const product = t1Product();
  const relationship = product.catalogMedia.find((item) => item.media_id === redIds[0]);
  relationship.renderUrl = `/api/catalog/products/${product.id}/media/${redIds[0]}?v=0123456789abcdef`;
  assert.equal(variantMediaSources(product, product.variants[0])[0], relationship.renderUrl);
  relationship.renderUrl = `/api/catalog/products/${product.id}/media/${redIds[0]}?v=not-safe`;
  assert.notEqual(variantMediaSources(product, product.variants[0])[0], relationship.renderUrl);
});

test("selected card colour is carried to product detail without changing the base route", () => {
  assert.equal(productVariantHref("/products/p1", "colour:ivory"), "/products/p1?variant=colour%3Aivory");
  assert.equal(productVariantHref("/products/p1?from=collection", "colour:red"), "/products/p1?from=collection&variant=colour%3Ared");
  assert.match(productRoute, /initialVariantId/);
  assert.match(productDetail, /variant\.id === initialVariantId/);
  assert.match(productDetail, /searchParams\.set\("variant", variantId\)/);
});

test("collection colour matching uses canonical variants and ignores stale attribute casing", () => {
  const product = t1Product();
  product.attributes = { colors: ["red", "green"] };
  assert.deepEqual(productColours(product), ["RED", "BLUE"]);
  assert.equal(productHasColour(product, " red "), true);
  assert.equal(productHasColour(product, "BLUE"), true);
  assert.equal(productHasColour(product, "green"), false);
  assert.equal(productHasColour(product, ""), true);
});

test("filter changes select the matching card variant without leaving cards hidden", () => {
  assert.match(collectionProducts, /selectedColour=\{color\}/);
  assert.match(card, /normalizeColour\(variant\.colour\) === normalizeColour\(selectedColour\)/);
  assert.match(card, /selectedColour && !filteredVariant \? undefined : resolvedImages\.primary/);
  assert.match(card, /primarySource && !primaryFailed/);
  assert.match(collectionProducts, /initial="hidden" animate="visible"/);
  assert.doesNotMatch(collectionProducts, /whileInView="visible"/);
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
  assert.match(editor, /failedMediaIds/);
  assert.match(editor, /failedMediaIds\.has\(item\.id\)/);
  assert.match(editor, /setFailedMediaIds\(new Set\(\)\)/);
  assert.match(editor, /onError=\{\(\) => setFailedMediaIds\(\(current\) => new Set\(current\)\.add\(item\.id\)\)\}/);
  assert.match(editor, /Unsaved image relationship/);
  assert.match(editor, /Preview unavailable/);
});
