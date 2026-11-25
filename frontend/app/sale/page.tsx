import { SaleStorefront } from '@/components/sale-storefront';
import { loadSale } from '@/lib/server-sale';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Sale' };
export default async function SalePage() { return <SaleStorefront initial={await loadSale()} />; }
