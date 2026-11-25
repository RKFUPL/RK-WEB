'use client';
import { useCurrency } from './currency-provider';
import { useSalePrice } from '@/lib/sale-price';
import type { SalePrice } from '@/lib/catalog';

export function SaleAmount({ amount, sale }: {amount:number; sale?:SalePrice}) {
  const {formatPrice}=useCurrency();
  const current=useSalePrice(amount,sale);
  return <span className="inline-flex flex-wrap items-baseline gap-2"><span>{formatPrice(current.amount)}</span>{current.sale?.isOnSale&&<><del className="text-xs text-charcoal/45">{formatPrice(sale?.mrp)}</del><span className="text-xs text-red-700">{sale?.discountPercent}% OFF</span></>}</span>;
}
