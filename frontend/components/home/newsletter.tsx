'use client';

import Image from 'next/image';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { brandStory } from '@/lib/home-content';

export function Newsletter() {
  return (
    <section id="journal" className="newsletter-editorial-section bg-ivory">
      <div className="mx-auto w-full max-w-[90rem] px-4 py-12 sm:px-6 sm:py-16 lg:px-12 lg:py-36">
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center gap-4 sm:gap-6 lg:gap-12">
        <div className="min-w-0 space-y-3 sm:space-y-5 lg:space-y-8">
          <div className="space-y-3 sm:space-y-5">
            <div className="flex flex-wrap items-center gap-2 sm:gap-4"><p className="text-[clamp(0.42rem,1vw,0.7rem)] uppercase tracking-[0.12em] text-gold sm:tracking-[0.2em] lg:tracking-[0.36em]">An Invitation into Our World</p><span className="h-px w-5 shrink-0 bg-gold/60 sm:w-8 lg:w-14" /></div>
            <h2 className="max-w-lg font-display text-[clamp(1.25rem,5.5vw,6rem)] leading-[0.96] tracking-[-0.04em] text-charcoal">Your vision belongs here.</h2>
            <p className="max-w-lg font-display text-[clamp(0.72rem,2vw,1.875rem)] leading-[1.2] text-charcoal/70 sm:leading-[1.25]">
              Your vision belongs here. Explore our opportunities and apply to join the House today.
            </p>
            <Link href="/careers" className="inline-flex items-center gap-4 border-b border-gold pb-3 text-[0.65rem] uppercase tracking-[0.28em] text-charcoal transition hover:text-gold">Explore careers <span aria-hidden="true">→</span></Link>
          </div>
        </div>

        <motion.div
          className="relative w-full min-w-0 self-center"
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.18 }}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="relative w-full overflow-hidden rounded-[14px]"><Image src={brandStory.image} alt="Rashi Kapoor campaign" width={1920} height={1080} sizes="(max-width: 1024px) 50vw, 44vw" className="block h-auto w-full" /><div className="pointer-events-none absolute inset-0 rounded-[14px] bg-gradient-to-t from-[#17100d]/30 to-transparent" /></div>
        </motion.div>
      </div>
      </div>
    </section>
  );
}
