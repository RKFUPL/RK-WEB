'use client';

import { useEffect, useState } from 'react';
import type { SalePrice } from './catalog';
import { apiBaseUrl } from './rbac';

/** Elapsed time starts at a server observation; the device clock is not authority. */
export function useSalePrice(amount?: number, sale?: SalePrice, productId?: string, variantId?: string) {
  const [quote,setQuote]=useState<{amount:number;sale?:SalePrice;productId:string;variantId:string}|null>(null);
  useEffect(()=>setQuote(null),[amount,sale?.serverTime,productId,variantId]);
  useEffect(()=>{if(!productId||!variantId)return;let controller:AbortController|undefined;
    const refresh=async()=>{controller?.abort();const requestController=new AbortController();controller=requestController;try{
      const response=await fetch(`${apiBaseUrl}/api/sales/prices`,{method:'POST',cache:'no-store',signal:requestController.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({items:[{productId,variantId}]})});
      if(!response.ok)return;const data=await response.json();const row=data.prices?.find((item:{productId:string;variantId:string})=>item.productId===productId&&item.variantId===variantId);
      if(!requestController.signal.aborted&&row&&Number.isFinite(row.price)&&row.price>0)setQuote({amount:row.price,sale:row.sale,productId,variantId});
    }catch{/* Existing price remains; checkout still revalidates on the server. */}};
    window.addEventListener('rk-sale-state-refresh',refresh);return()=>{controller?.abort();window.removeEventListener('rk-sale-state-refresh',refresh);};
  },[productId,variantId]);
  const currentQuote=quote?.productId===productId&&quote?.variantId===variantId?quote:null;
  const currentSale=currentQuote?currentQuote.sale:sale;
  const currentAmount=currentQuote?currentQuote.amount:amount;
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    setExpired(false);
    if (!currentSale?.isOnSale || !currentSale.saleEndsAt || !currentSale.serverTime) return;
    const remaining = Date.parse(currentSale.saleEndsAt) - Date.parse(currentSale.serverTime);
    if (remaining <= 0) { setExpired(true); return; }
    const observed = performance.now();
    let timer: number;
    const tick = () => {
      const left = remaining - (performance.now() - observed);
      if (left <= 0) setExpired(true);
      else timer = window.setTimeout(tick, Math.min(left, 2147483647));
    };
    timer = window.setTimeout(tick, Math.min(remaining, 2147483647));
    return () => window.clearTimeout(timer);
  }, [currentSale?.saleEndsAt, currentSale?.serverTime, currentSale?.isOnSale]);
  return { amount: expired ? currentSale?.mrp : currentAmount, sale: expired ? undefined : currentSale };
}
