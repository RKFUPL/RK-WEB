import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const management = readFileSync(new URL("../components/collections/collection-management-detail.tsx", import.meta.url), "utf8");
const mediaEditor = readFileSync(new URL("../components/collections/create-product-media-editor.tsx", import.meta.url), "utf8");
const collectionList = readFileSync(new URL("../components/collections/collection-management-list.tsx", import.meta.url), "utf8");
const variantEditor = readFileSync(new URL("../components/collections/variant-media-editor.tsx", import.meta.url), "utf8");

test("Add product opens the four-section product drawer instead of a reduced form", () => {
  assert.match(management, /function CreateProductDrawer/);
  for (const section of ["Overview", "Media & galleries", "Details", "Pricing & inventory"]) {
    assert.match(management, new RegExp(section.replace("&", "&")));
  }
  assert.doesNotMatch(management, /Create and assign/);
  assert.match(management, /Assign an existing product/);
});

test("create mode posts collection assignment and media in the initial product request", () => {
  assert.match(management, /collectionId: collection\.id/);
  assert.match(management, /media: media\.map/);
  assert.match(management, /The product was created, but authoritative read-back is unavailable/);
  assert.match(management, /Verify saved product/);
});

test("draft galleries use stable colour IDs and retain primary and hover choices", () => {
  assert.match(management, /id: `colour:\$\{colourSlug\}`/);
  assert.match(mediaEditor, /parseWorkDriveBatch\(batch\)/);
  assert.match(mediaEditor, /is_primary/);
  assert.match(mediaEditor, /is_hover/);
  assert.match(mediaEditor, /variant_id: selected\.id/);
});

test("colour galleries come first and can add a colour without leaving Media", () => {
  const galleryPosition = management.indexOf("<CreateProductMediaEditor");
  const productImagesPosition = management.indexOf("Product images", galleryPosition);
  assert.ok(galleryPosition >= 0 && productImagesPosition > galleryPosition);
  assert.match(mediaEditor, /Add colour/);
  assert.match(mediaEditor, /onAddColour/);
  assert.match(management, /setDraft\(\(state\) => \(\{ \.\.\.state, colors:/);
  assert.match(management, /CreateProductLevelMediaEditor/);
  assert.match(mediaEditor, /Optional general images for products without colour galleries/);
});

test("collection management exposes guarded archive and restore actions", () => {
  assert.match(management, /Archive collection/);
  assert.match(management, /Restore collection/);
  assert.match(management, /products and relationships were preserved/);
});

test("draft colours can be added repeatedly, renamed, and removed without crossing galleries", () => {
  assert.match(mediaEditor, /onRenameColour/);
  assert.match(mediaEditor, /onRemoveColour/);
  assert.match(mediaEditor, /discard its.*draft image/);
  assert.match(management, /item\.variant_id === variantId/);
  assert.match(management, /item\.variant_id !== variantId/);
  assert.match(management, /Colour names must be unique/);
});

test("collection list creates an empty collection and verifies it by slug", () => {
  assert.match(collectionList, /Add new collection/);
  assert.match(collectionList, /POST/);
  assert.match(collectionList, /\/api\/staff\/collections/);
  assert.match(collectionList, /Verify saved collection/);
  assert.match(collectionList, /image-preview/);
});

test("archived collection detail exposes a guarded delete action", () => {
  assert.match(management, /Delete archived collection/);
  assert.match(management, /collection.status === "archived"/);
  assert.match(management, /method: "DELETE"/);
  assert.match(management, /window\.location\.assign\(basePath\)/);
});

test("variant gallery saves hover independently and reports non-JSON API failures safely", () => {
  assert.match(variantEditor, /is_hover: item\.hover/);
  assert.match(variantEditor, /is_primary: item\.primary/);
  assert.match(variantEditor, /returned a non-JSON response/);
  assert.match(variantEditor, /await load\(selected\.id\)/);
});

test("collection update stays disabled until a meaningful edit and verifies read-back", () => {
  assert.match(management, /disabled=\{busy \|\| !collectionDirty\}/);
  assert.match(management, /normalizeCollectionValue/);
  assert.match(management, /await load\(true\)/);
  assert.match(management, /Update collection/);
});
