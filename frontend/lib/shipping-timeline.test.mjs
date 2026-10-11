import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { addToCart, updateCartItemSize } from './cart.ts';
import { cartItemShippingTimeline, productShippingTimeline } from './shipping-timeline.ts';

const productPage = readFileSync(new URL('../components/products/product-detail-page.tsx', import.meta.url), 'utf8');
const timelineComponent = readFileSync(new URL('../components/commerce/shipping-timeline.tsx', import.meta.url), 'utf8');
const bagPage = readFileSync(new URL('../app/bag/page.tsx', import.meta.url), 'utf8');
const miniCart = readFileSync(new URL('../components/home/sticky-header.tsx', import.meta.url), 'utf8');
const checkout = readFileSync(new URL('../components/checkout/checkout-page.tsx', import.meta.url), 'utf8');

const baseProduct = {
  id: 'p1', availability: 'in_stock', currency: 'INR', media: [], catalogMedia: [], variants: [], attributes: {},
};

test('verified Ready-to-Wear and Made-to-Order timelines match the policy wording', () => {
  const ready = productShippingTimeline(baseProduct);
  const made = productShippingTimeline({ ...baseProduct, availability: 'custom_order' });
  assert.equal(ready.mode, 'ready_to_wear');
  assert.equal(ready.label, 'Ready-to-Wear (Ready-made)');
  assert.match(ready.detail, /3–4 weeks/);
  assert.equal(made.mode, 'made_to_order');
  assert.equal(made.label, 'Made-to-Order (MTO)');
  assert.match(made.detail, /7–8 weeks/);
  assert.match(ready.detail, /not a guaranteed delivery date/i);
  assert.match(made.detail, /not a guaranteed delivery date/i);
});

test('explicit variant fulfilment and custom sizing use the applicable timeline', () => {
  const variant = { id: 'colour:red', sku: 'RED', colour: 'Red', colourSlug: 'red', images: [], status: 'active', currency: 'INR', sizes: [], sizeInventory: [], metadata: { fulfilmentMode: 'made_to_order' } };
  assert.equal(productShippingTimeline(baseProduct, variant).mode, 'made_to_order');
  assert.equal(productShippingTimeline(baseProduct, undefined, true).mode, 'made_to_order');
});

test('unknown shipping information uses the neutral policy and Client Services fallback', () => {
  const timeline = productShippingTimeline({ ...baseProduct, availability: 'sold_out' });
  assert.equal(timeline.mode, 'unknown');
  assert.equal(timeline.verified, false);
  assert.match(timeline.detail, /Shipping & Returns/);
  assert.match(timeline.detail, /Client Services/);
});

test('cart keeps different item timelines through quantity merge and size changes', () => {
  const ready = { productId: 'ready', productCode: 'R', variantId: 'red', sku: 'R-RED', collection: 'One', colour: 'Red', name: 'Ready', price: 100, quantity: 1, shippingMode: 'ready_to_wear', size: 'M', sizeOptions: ['M', 'L'] };
  const made = { productId: 'made', productCode: 'M', variantId: 'blue', sku: 'M-BLUE', collection: 'Two', colour: 'Blue', name: 'Made', price: 200, quantity: 1, shippingMode: 'made_to_order', size: 'M', sizeOptions: ['M', 'L'] };
  let cart = addToCart({ items: [], currency: 'INR' }, ready);
  cart = addToCart(cart, made);
  cart = addToCart(cart, { ...ready, quantity: 2 });
  cart = updateCartItemSize(cart, 'made::blue::M::', 'L');
  assert.equal(cartItemShippingTimeline(cart.items.find((item) => item.productId === 'ready')).mode, 'ready_to_wear');
  assert.equal(cartItemShippingTimeline(cart.items.find((item) => item.productId === 'made')).mode, 'made_to_order');
  assert.equal(cart.items.find((item) => item.productId === 'ready').quantity, 3);
});

test('variant cart lines retain their own fulfilment classification', () => {
  const base = { productId: 'same', productCode: 'S', sku: 'S-RED', collection: 'One', colour: 'Red', name: 'Style', price: 100, quantity: 1, size: 'M' };
  let cart = addToCart({ items: [], currency: 'INR' }, { ...base, variantId: 'colour:red', shippingMode: 'ready_to_wear' });
  cart = addToCart(cart, { ...base, variantId: 'colour:blue', sku: 'S-BLUE', colour: 'Blue', shippingMode: 'made_to_order' });
  assert.equal(cart.items.length, 2);
  assert.equal(cartItemShippingTimeline(cart.items[0]).mode, 'ready_to_wear');
  assert.equal(cartItemShippingTimeline(cart.items[1]).mode, 'made_to_order');
});

test('product and bag surfaces show item-specific shipping links', () => {
  assert.equal((productPage.match(/<ShippingTimeline\b/g) || []).length, 1);
  assert.match(productPage, /ShippingTimeline timeline=\{shippingTimeline\} explainModels/);
  assert.doesNotMatch(productPage, /id: ["']shipping["']/);
  assert.match(productPage, /shippingMode: shippingTimeline\.mode/);
  assert.match(timelineComponent, /verifiedShippingPolicy\.readyToWear\.label/);
  assert.match(timelineComponent, /verifiedShippingPolicy\.madeToOrder\.label/);
  assert.match(timelineComponent, /These are estimates, not guaranteed delivery dates/);
  assert.match(timelineComponent, /href="\/shipping-returns"/);
  assert.match(bagPage, /cartItemShippingTimeline\(item\)/);
  assert.match(bagPage, /ShippingTimeline/);
  assert.match(miniCart, /cartItemShippingTimeline\(item\)/);
  assert.match(checkout, /cartItemShippingTimeline\(item\)/);
  assert.match(checkout, /ShippingTimeline/);
});
