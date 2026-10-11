'use client';

import { ArrowLeft, ArrowRight } from 'lucide-react';
import { motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { apiBaseUrl } from '@/lib/rbac';

type PublicTestimonial = { id: string; displayName: string; text: string; imageUrl?: string | null; contextLabel?: string | null };

function OptionalPortrait({ item, className }: { item: PublicTestimonial; className: string }) {
  const [failed, setFailed] = useState(false);
  if (!item.imageUrl || failed) return null;
  return <div className={className}><img src={item.imageUrl} alt={`Portrait of ${item.displayName}`} className="h-full w-full object-cover" loading="lazy" onError={() => setFailed(true)}/></div>;
}

export function Services() {
  const [items, setItems] = useState<PublicTestimonial[]>([]);
  const [ready, setReady] = useState(false);
  const shelfRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let active = true;
    fetch(`${apiBaseUrl}/api/content/testimonials`, { cache: 'no-store' })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? 'Unable to load testimonials.');
        if (active) setItems(Array.isArray(payload.items) ? payload.items : []);
      })
      .catch(() => { if (active) setItems([]); })
      .finally(() => { if (active) setReady(true); });
    return () => { active = false; };
  }, []);

  if (!ready || !items.length) return null;
  const move = (direction: -1 | 1) => shelfRef.current?.scrollBy({ left: direction * Math.max(280, shelfRef.current.clientWidth * 0.78), behavior: 'smooth' });

  return <section id="services" className="testimonial-editorial-section bg-ivory">
    <div className="mx-auto w-full max-w-7xl px-6 py-20 lg:px-10 lg:py-28">
      <div className="max-w-3xl space-y-5"><p className="text-xs uppercase tracking-[0.38em] text-charcoal/50">The house speaks</p><h2 className="font-display text-5xl leading-[0.9] text-charcoal md:text-7xl">Words from the women who wear our collection.</h2></div>
      <div className="relative mt-14 px-8 md:px-12"><button type="button" onClick={() => move(-1)} aria-label="Previous testimonial" className="absolute left-0 top-1/2 z-20 -translate-y-1/2 text-charcoal/60 transition-colors hover:text-gold"><ArrowLeft className="h-5 w-5"/></button><button type="button" onClick={() => move(1)} aria-label="Next testimonial" className="absolute right-0 top-1/2 z-20 -translate-y-1/2 text-charcoal/60 transition-colors hover:text-gold"><ArrowRight className="h-5 w-5"/></button>
        <div ref={shelfRef} className="testimonial-shelf flex snap-x snap-mandatory gap-6 overflow-x-auto pb-2 md:gap-8">{items.map((item) => <motion.article key={item.id} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: .15 }} className="group relative basis-full shrink-0 snap-start pt-4 text-left before:absolute before:inset-x-0 before:top-0 before:h-px before:origin-left before:scale-x-0 before:bg-gold before:transition-transform group-hover:before:scale-x-100 md:basis-[calc((100%-2rem)/2)] xl:basis-[calc((100%-4rem)/3)]"><OptionalPortrait item={item} className="aspect-[3/4] overflow-hidden bg-[#e8e0d4]"/><div className="border-l border-black/10 py-6 pl-5 md:pl-7"><p aria-hidden="true" className="font-display text-5xl leading-none text-gold">“</p><p className="testimonial-copy mt-1 max-w-sm font-display text-2xl leading-[1.08] md:text-3xl">{item.text}</p><p className="testimonial-name mt-7 text-[.65rem] uppercase tracking-[.3em]">{item.displayName}</p>{item.contextLabel ? <p className="testimonial-meta mt-2 text-xs uppercase tracking-[.24em]">{item.contextLabel}</p> : null}</div></motion.article>)}</div>
      </div>
    </div>
  </section>;
}
