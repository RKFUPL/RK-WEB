'use client';

import Image from 'next/image';
import { Check } from 'lucide-react';
import { useState } from 'react';
import { motion } from 'framer-motion';
import { brandStory } from '@/lib/home-content';

export function Newsletter() {
  const [email, setEmail] = useState('');
  const features = ['New collections', 'Editorial stories', 'Lookbooks', 'Private launches', 'Exclusive previews'];

  return (
    <section id="journal" className="newsletter-editorial-section bg-ivory">
      <div className="mx-auto w-full max-w-[90rem] px-6 py-24 lg:px-12 lg:py-36">
      <div className="grid gap-14 lg:grid-cols-[0.72fr_1.28fr] lg:items-center lg:gap-24">
        <div className="max-w-xl space-y-8">
          <div className="space-y-5">
            <div className="flex items-center gap-4"><p className="text-[0.62rem] uppercase tracking-[0.38em] text-gold">House notes</p><span className="h-px w-14 bg-gold/60" /></div>
            <h2 className="font-display text-[clamp(4rem,7vw,7.5rem)] leading-[0.82] tracking-[-0.04em] text-charcoal">Join<br /><em className="text-gold">the House.</em></h2>
            <p className="max-w-md font-display text-2xl leading-[1.2] text-charcoal/70 md:text-3xl">
              A private line into new collections, craftsmanship stories, lookbooks, launches and considered previews from the world of RK.
            </p>
            <ul className="grid gap-3 text-[0.68rem] uppercase tracking-[0.2em] text-charcoal/65 sm:grid-cols-2">
              {features.map((feature) => (
                <li key={feature} className="flex items-center gap-3">
                  <Check className="h-3.5 w-3.5 text-charcoal/55" strokeWidth={1.5} />
                  {feature}
                </li>
              ))}
            </ul>
          </div>

          <form className="max-w-lg" onSubmit={(event) => event.preventDefault()}>
            <label className="sr-only" htmlFor="newsletter-email">Your email</label>
            <div className="flex border-b border-charcoal/30 py-2 focus-within:border-gold">
              <input
                id="newsletter-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="Your email"
                className="min-w-0 flex-1 bg-transparent px-0 py-3 text-sm text-charcoal outline-none placeholder:text-charcoal/40"
              />
              <button type="submit" className="bg-charcoal px-7 py-4 text-[0.65rem] uppercase tracking-[0.28em] text-ivory transition-colors duration-500 hover:bg-gold hover:text-ink">
                Subscribe
              </button>
            </div>
            <p className="mt-4 text-[0.62rem] uppercase tracking-[0.2em] text-charcoal/40">Privacy respected. Unsubscribe anytime.</p>
          </form>
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
