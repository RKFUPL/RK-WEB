import { SaleStorefront } from '@/components/sale-storefront';
import { loadSale } from '@/lib/server-sale';
export const dynamic = 'force-dynamic';
export default async function CampaignPage({params}: {params:Promise<{slug:string}>}) { const {slug}=await params; return <SaleStorefront initial={await loadSale(slug)} slug={slug} />; }
