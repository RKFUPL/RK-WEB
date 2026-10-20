'use client';

import Image from 'next/image';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { brandStory } from '@/lib/home-content';

export function Newsletter() {
  return (
    <section id="journal" className="newsletter-editorial-section bg-ivory">
      <div className="mx-auto w-full max-w-[90rem] px-6 py-24 lg:px-12 lg:py-36">
      <div className="grid gap-14 lg:grid-cols-[0.72fr_1.28fr] lg:items-center lg:gap-24">
        <div className="max-w-xl space-y-8">
          <div className="space-y-5">
            <div className="flex items-center gap-4"><p className="text-[0.7rem] uppercase tracking-[0.36em] text-gold">An Invitation into Our World</p><span className="h-px w-14 bg-gold/60" /></div>
            <h2 className="max-w-lg font-display text-[clamp(3.3rem,5.5vw,6rem)] leading-[0.92] tracking-[-0.04em] text-charcoal">Your vision belongs here.</h2>
            <p className="max-w-lg font-display text-2xl leading-[1.25] text-charcoal/70 md:text-3xl">
              Your vision belongs here. Explore our opportunities and apply to join the House today.
            </p>
            <Link href="/careers" className="inline-flex items-center gap-4 border-b border-gold pb-3 text-[0.65rem] uppercase tracking-[0.28em] text-charcoal transition hover:text-gold">Explore careers <span aria-hidden="true">→</span></Link>
          </div>
        </div>

        <motion.div
          className="relative aspect-[4/5] overflow-hidden border border-black/10 bg-sand p-3 lg:aspect-[1.08/1]"
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.18 }}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="relative h-full w-full overflow-hidden rounded-[14px]"><Image src={brandStory.image} alt="Rashi Kapoor campaign" fill sizes="(max-width: 1024px) 100vw, 58vw" className="object-cover object-center transition duration-[1400ms] hover:scale-[1.04]" /><div className="absolute inset-0 bg-gradient-to-t from-[#17100d]/30 to-transparent" /></div>
        </motion.div>
      </div>
      </div>
    </section>
  );
}
