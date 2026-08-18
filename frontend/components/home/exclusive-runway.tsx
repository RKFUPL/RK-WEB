'use client';

import Link from 'next/link';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useState } from 'react';
import { runwayCollections } from '@/lib/home-content';

export function ExclusiveRunway() {
  const [activeIndex, setActiveIndex] = useState(0);
  const collection = runwayCollections[activeIndex] ?? runwayCollections[0];

  const hasMultipleCollections = runwayCollections.length > 1;
  const showPrevious = () => setActiveIndex((index) => (index - 1 + runwayCollections.length) % runwayCollections.length);
  const showNext = () => setActiveIndex((index) => (index + 1) % runwayCollections.length);
  const status = collection.status.replaceAll('-', ' ');

  return (
    <aside aria-labelledby="exclusive-runway-title" className="w-full border-t border-gold/45 pt-10">
      <div className="flex items-start justify-between gap-4">
        <h3 id="exclusive-runway-title" className="max-w-[11ch] font-display text-[clamp(2.8rem,4.4vw,4.5rem)] uppercase leading-[0.94] tracking-[-0.035em] text-charcoal">THE RUNWAY EXCLUSIVE</h3>
        {hasMultipleCollections ? <div className="flex items-center gap-1">
          <button type="button" onClick={showPrevious} aria-label="Previous runway collection" className="grid h-7 w-7 place-items-center border border-gold/35 text-gold transition hover:border-gold hover:bg-gold hover:text-ink"><ArrowLeft size={12} /></button>
          <button type="button" onClick={showNext} aria-label="Next runway collection" className="grid h-7 w-7 place-items-center border border-gold/35 text-gold transition hover:border-gold hover:bg-gold hover:text-ink"><ArrowRight size={12} /></button>
        </div> : null}
      </div>

      <Link href={collection.href} className="group relative mt-10 block aspect-[3/4] overflow-hidden rounded-[14px] border border-gold/35 bg-[#0b0a08] text-[#f4ede2] transition duration-500 hover:border-gold/70">
        {collection.image ? <img src={collection.image} alt={`${collection.name} runway collection`} className="absolute inset-0 h-full w-full object-cover transition duration-1000 ease-out group-hover:scale-[1.025]" /> : <div aria-hidden="true" className="absolute inset-0 bg-[radial-gradient(circle_at_78%_24%,rgba(181,138,76,0.2),transparent_30%),linear-gradient(135deg,#17130f,#080706)]" />}
        <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/35 to-black/5" />
        <div className="relative flex h-full flex-col justify-end p-6">
          <p className="text-[0.52rem] uppercase tracking-[0.3em] text-gold/80">Runway collection</p>
          <h4 className="mt-2 font-display text-[2rem] leading-[0.9] text-[#f5efe5]">{collection.name}</h4>
          <p className="mt-3 text-[0.54rem] uppercase tracking-[0.28em] text-gold/85">{status}</p>
          <span className="mt-6 inline-flex items-center gap-3 text-[0.55rem] uppercase tracking-[0.25em] text-gold transition group-hover:text-[#f5efe5]">View runway <ArrowRight className="h-3.5 w-3.5 transition-transform duration-300 group-hover:translate-x-1.5" /></span>
        </div>
      </Link>
    </aside>
  );
}
