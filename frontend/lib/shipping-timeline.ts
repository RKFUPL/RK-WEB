import type { CatalogProduct, CatalogProductVariant } from './catalog';
import type { CartItem } from './store-types';

export const verifiedShippingPolicy = {
  readyToWear: { label: 'Ready-to-Wear (Ready-made)', estimate: '3–4 weeks', scope: 'dispatch' },
  madeToOrder: { label: 'Made-to-Order (MTO)', estimate: '7–8 weeks', scope: 'production and dispatch' },
} as const;

export type ShippingTimelineMode = 'ready_to_wear' | 'made_to_order' | 'unknown';
export type ShippingTimeline = { mode: ShippingTimelineMode; label: string; detail: string; verified: boolean };

const timelines: Record<ShippingTimelineMode, ShippingTimeline> = {
  ready_to_wear: {
    mode: 'ready_to_wear',
    label: verifiedShippingPolicy.readyToWear.label,
    detail: `Estimated dispatch in ${verifiedShippingPolicy.readyToWear.estimate}. This is a dispatch estimate, not a guaranteed delivery date.`,
    verified: true,
  },
  made_to_order: {
    mode: 'made_to_order',
    label: verifiedShippingPolicy.madeToOrder.label,
    detail: `Estimated production and dispatch in ${verifiedShippingPolicy.madeToOrder.estimate}. This is not a guaranteed delivery date.`,
    verified: true,
  },
  unknown: {
    mode: 'unknown',
    label: 'Timeline confirmed individually',
    detail: 'Please review Shipping & Returns or contact Client Services for the applicable timeline before ordering.',
    verified: false,
  },
};

function explicitMode(value: unknown): ShippingTimelineMode | undefined {
  const mode = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (['made_to_order', 'custom_order', 'bespoke', 'custom_size'].includes(mode)) return 'made_to_order';
  if (['ready_to_wear', 'rtw'].includes(mode)) return 'ready_to_wear';
  return undefined;
}

export function productShippingTimeline(product: CatalogProduct, variant?: CatalogProductVariant, customSize = false): ShippingTimeline {
  const metadata = variant?.metadata || {};
  const attributes = product.attributes || {};
  const mode = explicitMode(metadata.fulfilmentMode || metadata.fulfillmentMode || metadata.productionMode)
    || explicitMode(attributes.fulfilmentMode || attributes.fulfillmentMode || attributes.productionMode)
    || (customSize ? 'made_to_order' : undefined)
    || (product.availability === 'custom_order' ? 'made_to_order' : product.availability === 'in_stock' ? 'ready_to_wear' : 'unknown');
  return timelines[mode];
}

export function cartItemShippingTimeline(item: CartItem): ShippingTimeline {
  const persisted = explicitMode(item.shippingMode);
  if (persisted) return timelines[persisted];
  if (item.purchaseMode === 'custom_size' || String(item.availability || '').toLowerCase().replace(/[\s-]+/g, '_') === 'custom_order') return timelines.made_to_order;
  if (String(item.availability || '').toLowerCase().replace(/[\s-]+/g, '_') === 'in_stock') return timelines.ready_to_wear;
  return timelines.unknown;
}
