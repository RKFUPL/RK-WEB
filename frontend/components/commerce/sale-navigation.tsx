'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { apiBaseUrl } from '@/lib/rbac';

export function SaleNavigation({ className = '', onNavigate }: {className?:string; onNavigate?:()=>void}) {
  const [available,setAvailable]=useState(false);
  useEffect(()=>{let active=true;let expiry:ReturnType<typeof setTimeout>;async function load(){try{const r=await fetch(`${apiBaseUrl}/api/sales/public`,{cache:'no-store'});const data=await r.json();if(!active)return;setAvailable(r.ok&&data.available===true);clearTimeout(expiry);if(r.ok&&data.campaigns?.length){const remaining=Math.max(...data.campaigns.map((c:{endsAt:string})=>Date.parse(c.endsAt)))-Date.parse(data.serverTime);expiry=setTimeout(()=>{setAvailable(false);void load();},Math.max(0,Math.min(remaining,2147483647)));}}catch{if(active)setAvailable(false);}}void load();window.addEventListener('rk-sale-state-refresh',load);const interval=setInterval(()=>void load(),30000);return()=>{active=false;window.removeEventListener('rk-sale-state-refresh',load);clearInterval(interval);clearTimeout(expiry);};},[]);
  return available?<Link href="/sale" onClick={onNavigate} className={`${className} !text-red-700 dark:!text-red-400`}>SALE</Link>:null;
}
