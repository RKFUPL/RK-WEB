import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const detail = readFileSync(new URL("../components/products/product-detail-page.tsx", import.meta.url), "utf8");
const tryon = readFileSync(new URL("../components/products/ai-tryon.tsx", import.meta.url), "utf8");
const editor = readFileSync(new URL("../components/collections/collection-management-detail.tsx", import.meta.url), "utf8");

test("product detail passes the selected variant and current gallery image to Try-On", () => {
  assert.match(detail, /<AiTryon product=\{product\} variantId=\{selectedVariant\?\.id\} productImage=\{currentMainImage \|\| media\[0\] \|\| ""\} \/>/);
});

test("Try-On visibility checks product eligibility, service config, permissions, and image availability", () => {
  assert.match(tryon, /product\.aiTryonEnabled/);
  assert.match(tryon, /payload\.allowLoggedIn/);
  assert.match(tryon, /payload\.allowGuests/);
  assert.match(tryon, /!productImage/);
  assert.match(tryon, /productId', product\.id/);
  assert.match(tryon, /variantId', variantId/);
});

test("admin product create and edit surfaces persist Try-On eligibility", () => {
  assert.match(editor, /aiTryonEnabled: false/);
  assert.match(editor, /aiTryonEnabled: draft\.aiTryonEnabled/);
  assert.match(editor, /checked=\{form\.aiTryonEnabled\}/);
});
