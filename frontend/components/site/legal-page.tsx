import Link from 'next/link';
import { Footer } from '@/components/home/footer';
import { StickyHeader } from '@/components/home/sticky-header';
import { LegalContentsNav } from '@/components/site/legal-contents-nav';
import { featuredCollection } from '@/lib/home-content';
import { legalIdentity } from '@/lib/legal-identity';

export type LegalSection = { title: string; body: string; paragraphs?: string[] };

export function LegalPage({ eyebrow, title, intro, updated = '08 October 2026', sections }: { eyebrow: string; title: string; intro: string; updated?: string; sections: LegalSection[] }) {
  return (
    <main className="bg-ivory text-charcoal">
      <StickyHeader />
      <section className="legal-hero relative isolate overflow-hidden bg-[#24150e] text-white">
        <img src={featuredCollection.image} alt="" aria-hidden="true" className="absolute inset-0 -z-20 h-full w-full object-cover object-center" />
        <div className="absolute inset-0 -z-10 bg-[linear-gradient(90deg,rgba(25,13,8,.94)_0%,rgba(25,13,8,.76)_48%,rgba(25,13,8,.32)_100%)]" />
        <div className="mx-auto flex min-h-[21rem] max-w-7xl items-end px-6 pb-12 pt-24 md:min-h-[24rem] md:px-10 md:pb-14 md:pt-28">
          <div className="max-w-3xl">
            <p className="text-[0.65rem] uppercase tracking-[0.4em] text-gold">{eyebrow}</p>
            <h1 className="mt-5 max-w-4xl font-display text-[clamp(3.15rem,7vw,6.75rem)] leading-[0.88] tracking-[-0.05em]">{title}</h1>
            <p className="mt-6 max-w-2xl text-[0.95rem] leading-7 text-white/84 md:text-base md:leading-8">{intro}</p>
            <p className="mt-7 text-[0.62rem] uppercase tracking-[0.3em] text-white/70">Last updated: {updated}</p>
          </div>
        </div>
      </section>
      <div className="mx-auto max-w-7xl px-6 pt-8 md:hidden">
        <LegalContentsNav sections={sections} mobile />
      </div>
      <div className="mx-auto grid max-w-7xl gap-12 px-6 py-14 md:grid-cols-[16rem_minmax(0,1fr)] md:px-10 md:py-20 lg:gap-20">
        <aside className="hidden h-fit md:sticky md:top-28 md:block">
          <p className="text-[0.62rem] uppercase tracking-[0.38em] text-gold">On this page</p>
          <LegalContentsNav sections={sections} />
        </aside>
        <article className="min-w-0 max-w-[47rem] divide-y divide-black/10 dark:divide-white/10">
          {sections.map((section, index) => (
            <section id={`section-${index + 1}`} key={section.title} className="scroll-mt-28 py-11 first:pt-0 last:pb-0 md:scroll-mt-32 md:py-14">
              <p className="text-[0.62rem] uppercase tracking-[0.35em] text-gold">{String(index + 1).padStart(2, '0')}</p>
              <h2 className="mt-4 text-balance font-display text-[clamp(2rem,4vw,3.35rem)] leading-[1.02] tracking-[-0.025em]">{section.title}</h2>
              <div className="mt-6 space-y-5">
                {(section.paragraphs?.length ? section.paragraphs : [section.body]).map((paragraph) => (
                  <p key={paragraph} className="break-words text-[0.95rem] leading-8 text-charcoal/72 md:text-base md:leading-8">{paragraph}</p>
                ))}
              </div>
            </section>
          ))}
          <p className="pt-10 text-sm leading-8 text-charcoal/55">Questions about this page? Contact <Link href={`mailto:${legalIdentity.customerCareEmail}`} className="text-gold underline-offset-4 hover:underline">{legalIdentity.customerCareEmail}</Link>.</p>
        </article>
      </div>
      <Footer />
    </main>
  );
}
