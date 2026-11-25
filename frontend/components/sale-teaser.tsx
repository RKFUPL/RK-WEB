'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { StickyHeader } from '@/components/home/sticky-header';
import { Footer } from '@/components/home/footer';
import { apiBaseUrl } from '@/lib/rbac';
import type { CampaignAnnouncement } from '@/components/commerce/sale-announcement';
import { SaleBannerMedia } from '@/components/sale-banner-media';
import { SaleHeroContent } from '@/components/sale-hero-content';

export type TeaserPayload={campaign:CampaignAnnouncement;serverTime:string};
export function SaleTeaser({initial}:{initial:TeaserPayload}){
  const router=useRouter();const [data,setData]=useState(initial);const [available,setAvailable]=useState(true);
  useEffect(()=>{let active=true;const controller=new AbortController();async function refresh(){try{
    const response=await fetch(`${apiBaseUrl}/api/sales/teaser/${encodeURIComponent(initial.campaign.slug)}`,{cache:'no-store',signal:controller.signal});
    if(!active)return;if(response.status===404){setAvailable(false);router.refresh();return;}if(!response.ok){setAvailable(false);return;}
    const value=await response.json();if(!active)return;if(value.redirect){router.replace('/sale');return;}setData(value);setAvailable(true);
  }catch{if(active)setAvailable(false);}}
  const interval=setInterval(()=>void refresh(),15000);
  const transition=setTimeout(()=>{setAvailable(false);void refresh();},Math.max(0,Math.min(Date.parse(data.campaign.startsAt)-Date.parse(data.serverTime),2147483647)));
  return()=>{active=false;controller.abort();clearInterval(interval);clearTimeout(transition);};},[data.serverTime,initial.campaign.slug,router]);
  const campaign=data.campaign;
  return <main className="min-h-screen bg-ivory text-charcoal"><StickyHeader/><section className="w-full pb-24 pt-[var(--rk-header-height,88px)]">
    {available?<><div className="mx-auto w-[calc(100%-2rem)] sm:w-[calc(100%-2.5rem)] md:w-[88%] lg:w-[85%] xl:w-[min(60rem,calc(100%-6rem))]" data-testid="teaser-banner"><div className="relative w-full"><SaleBannerMedia url={campaign.bannerUrl} type={campaign.bannerMediaType} posterUrl={campaign.bannerPosterUrl} alt={campaign.title} imageClassName="block h-auto w-full object-contain object-center" videoClassName="block h-auto w-full object-contain object-center" testId="teaser-banner-media"/><p data-testid="teaser-watermark" className="pointer-events-none absolute inset-0 flex items-center justify-center whitespace-nowrap font-display text-[clamp(1.5rem,6vw,6rem)] font-semibold uppercase leading-none tracking-[.04em] text-ivory opacity-50">COMING SOON</p><SaleHeroContent title={campaign.title} subtitle={campaign.subtitle} date={campaign.startsAt} timezone={campaign.timezone} upcoming/></div></div></>:<p role="status">Checking campaign availability…</p>}
  </section><Footer/></main>;
}
