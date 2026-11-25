'use client';
import Link from 'next/link';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { apiBaseUrl } from '@/lib/rbac';

export type CampaignAnnouncement = {id:string;title:string;slug:string;subtitle:string;message:string;startsAt:string;endsAt:string;timezone:string;bannerUrl:string;bannerMediaType?:'image'|'video';bannerPosterUrl?:string|null;href:string;phase:'live'|'upcoming'};
type AnnouncementState = {announcement:CampaignAnnouncement|null;serverTime:string;nextChangeAt:string|null;liveAvailable:boolean};

export function SaleAnnouncement() {
  const reducedMotion=useReducedMotion();
  const [state,setState]=useState<AnnouncementState|null>(null);
  useEffect(()=>{let active=true;let boundary:ReturnType<typeof setTimeout>;let controller:AbortController|undefined;let previousLive:boolean|undefined;let boundaryRefresh=false;
    async function refresh(){controller?.abort();const requestController=new AbortController();controller=requestController;try{
      const response=await fetch(`${apiBaseUrl}/api/sales/announcement`,{cache:'no-store',signal:requestController.signal});
      if(!response.ok)throw new Error('Unavailable');const value:AnnouncementState=await response.json();if(!active||requestController.signal.aborted)return;
      setState(value);if(boundaryRefresh || (previousLive!==undefined && previousLive!==value.liveAvailable))window.dispatchEvent(new Event('rk-sale-state-refresh'));previousLive=value.liveAvailable;boundaryRefresh=false;clearTimeout(boundary);
      const remaining=value.nextChangeAt?Date.parse(value.nextChangeAt)-Date.parse(value.serverTime):NaN;
      if(Number.isFinite(remaining))boundary=setTimeout(()=>{setState(null);boundaryRefresh=true;void refresh();},Math.max(50,Math.min(remaining,2147483647)));
    }catch(error){if(active && !(error instanceof DOMException&&error.name==='AbortError'))setState(null);}}
    void refresh();const timer=setInterval(()=>void refresh(),15000);window.addEventListener('focus',refresh);
    return()=>{active=false;controller?.abort();clearInterval(timer);clearTimeout(boundary);window.removeEventListener('focus',refresh);};
  },[]);
  const announcement=state?.announcement;
  return <AnimatePresence initial={false}>{announcement&&<motion.div initial={{height:0}} animate={{height:32}} exit={{height:0}} transition={{duration:reducedMotion?0:.2,ease:'easeOut'}} className="overflow-hidden bg-ivory text-charcoal dark:bg-[#191713] dark:text-ivory" data-testid="sale-announcement-slot">
    <Link href={announcement.href} aria-label={announcement.message} className="rk-sale-runner block h-8 overflow-hidden text-[11px] uppercase leading-8 tracking-[.12em] focus-visible:outline focus-visible:outline-gold sm:text-[12.5px]">
      <span className="rk-sale-runner-track flex w-max" aria-hidden="true">{[0,1].map(copy=><span key={copy} className="flex shrink-0">{[0,1,2,3].map(index=><span key={index} className="whitespace-nowrap px-9">{announcement.message}<span className="ml-9 text-red-700">SALE</span></span>)}</span>)}</span>
    </Link>
  </motion.div>}</AnimatePresence>;
}
