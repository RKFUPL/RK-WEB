'use client';

import { useLayoutEffect } from 'react';
import { FeaturedCollection } from '@/components/home/featured-collection';
import { Footer } from '@/components/home/footer';
import { SectionShell } from '@/components/home/section-shell';
import { StickyHeader } from '@/components/home/sticky-header';
import { featuredCollectionFrames } from '@/lib/home-content';

function AakaarLightModeStart() {
  useLayoutEffect(() => {
    document.documentElement.classList.remove('dark');
    window.localStorage.setItem('rk-theme', 'light');
    window.dispatchEvent(new CustomEvent('rk-theme-change', { detail: false }));
  }, []);

  return null;
}

const previewImages = [
  featuredCollectionFrames[0],
  featuredCollectionFrames[1],
  featuredCollectionFrames[2],
] as const;

export function AakaarPage() {
  return (
    <main className="aakaar-page min-h-screen bg-ivory text-charcoal">
      <AakaarLightModeStart />
      <StickyHeader transparentAtTop />
      <FeaturedCollection />

      <section aria-labelledby="aakaar-coming-soon" className="bg-ivory text-charcoal dark:bg-[#0b0b0b] dark:text-[#f5f2ee]">
        <SectionShell className="pb-24 pt-20 lg:pb-32 lg:pt-28">
          <header className="mx-auto max-w-2xl text-center">
            <p className="text-[0.62rem] uppercase tracking-[0.38em] text-gold">Newest collection</p>
            <h1 id="aakaar-coming-soon" className="mt-5 font-display text-[clamp(3.6rem,9vw,7.5rem)] leading-[0.82] tracking-[-0.04em]">
              Coming soon.
            </h1>
            <p className="mt-7 font-display text-xl italic leading-tight text-charcoal/65 dark:text-[#f5f2ee]/65 md:text-2xl">
              A preview of what&apos;s next.
            </p>
          </header>

          <div className="mt-16 grid gap-6 md:grid-cols-3 lg:mt-20 lg:gap-8">
            {previewImages.map((image, index) => (
              <article key={image} className="overflow-hidden border border-black/10 bg-[#f8f6f2] dark:border-white/10 dark:bg-[#121212]">
                <div className="aspect-[3/4] overflow-hidden bg-sand dark:bg-[#181513]">
                  <img
                    src={image}
                    alt={`Aakaar campaign preview ${index + 1}`}
                    draggable={false}
                    loading={index === 0 ? 'eager' : 'lazy'}
                    decoding="async"
                    className="block h-full w-full object-cover object-center"
                  />
                </div>
                <div className="flex items-center justify-between gap-4 border-t border-black/10 px-5 py-5 dark:border-white/10 md:px-6">
                  <p className="text-[0.58rem] uppercase tracking-[0.28em] text-charcoal/65 dark:text-[#f5f2ee]/65">Aakaar / Preview {String(index + 1).padStart(2, '0')}</p>
                  <p className="shrink-0 text-[0.52rem] uppercase tracking-[0.25em] text-gold">Coming soon</p>
                </div>
              </article>
            ))}
          </div>

          <div className="mt-16 border-t border-black/10 pt-10 text-center dark:border-white/10 lg:mt-20">
            <p className="text-[0.58rem] uppercase tracking-[0.32em] text-charcoal/55 dark:text-[#f5f2ee]/55">For more information, contact</p>
            <a href="mailto:contact@rashikapooroffical.com" className="mt-3 inline-block font-display text-xl text-charcoal transition hover:text-gold dark:text-[#f5f2ee] md:text-2xl">
              contact@rashikapooroffical.com
            </a>
          </div>
        </SectionShell>
      </section>

      <Footer />
    </main>
  );
}
