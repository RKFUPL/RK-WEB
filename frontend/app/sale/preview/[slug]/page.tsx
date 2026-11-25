import { notFound, redirect } from 'next/navigation';
import { SaleTeaser } from '@/components/sale-teaser';
export const dynamic='force-dynamic';
export const metadata={title:'Coming Soon'};
export default async function TeaserPage({params}:{params:Promise<{slug:string}>}){
  const {slug}=await params;
  const base=process.env.BACKEND_INTERNAL_URL||'http://127.0.0.1:5000';
  const response=await fetch(`${base}/api/sales/teaser/${encodeURIComponent(slug)}`,{cache:'no-store'});
  if(response.status===404)notFound();if(!response.ok)throw new Error('Campaign temporarily unavailable.');
  const data=await response.json();if(data.redirect)redirect('/sale');return <SaleTeaser initial={data}/>;
}
