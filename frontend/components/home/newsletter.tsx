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
      <div className="mx-auto w-full max-w-7xl px-6 py-20 lg:px-10 lg:py-28">
      <div className="grid gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:items-center lg:gap-20">
        <div className="max-w-xl space-y-7">
          <div className="space-y-5">
            <p className="text-xs uppercase tracking-[0.38em] text-charcoal/50">House notes</p>
            <h2 className="font-display text-6xl leading-[0.88] text-charcoal md:text-8xl">Join the House.</h2>
            <p className="max-w-md text-base leading-8 text-charcoal/70">
              Be the first to discover new collections, exclusive launches, lookbooks, and stories from the world of RK.
            </p>
            <ul className="space-y-3 text-sm uppercase tracking-[0.18em] text-charcoal/65">
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
              <button type="submit" className="bg-charcoal px-6 py-3 text-xs uppercase tracking-[0.28em] text-ivory transition-colors duration-150 hover:bg-gold hover:text-ink">
                Subscribe
              </button>
            </div>
            <p className="mt-4 text-[0.62rem] uppercase tracking-[0.2em] text-charcoal/40">Privacy respected. Unsubscribe anytime.</p>
          </form>
        </div>

        <motion.div
          className="relative aspect-[4/5] overflow-hidden bg-sand lg:aspect-[5/6]"
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.18 }}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        >
          <Image src={brandStory.image} alt="Rashi Kapoor campaign" fill sizes="(max-width: 1024px) 100vw, 50vw" className="object-cover object-center" />
        </motion.div>
      </div>
      </div>
    </section>
  );
}
