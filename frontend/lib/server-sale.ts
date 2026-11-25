import 'server-only';
import { notFound } from 'next/navigation';
import type { SalePayload } from '@/components/sale-storefront';

export async function loadSale(slug?: string): Promise<SalePayload> {
  const base = process.env.BACKEND_INTERNAL_URL || 'http://127.0.0.1:5000';
  const response = await fetch(`${base}/api/sales/public${slug ? `?campaign=${encodeURIComponent(slug)}` : ''}`, { cache: 'no-store' });
  if (response.status === 404) notFound();
  if (!response.ok) throw new Error('Sale is temporarily unavailable.');
  return response.json();
}
