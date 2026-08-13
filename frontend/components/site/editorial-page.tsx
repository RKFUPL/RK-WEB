import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { Footer } from '@/components/home/footer';
import { StickyHeader } from '@/components/home/sticky-header';

type EditorialSection = {
  eyebrow: string;
  title: string;
  body: string;
  image?: string;
  imageAlt?: string;
  imageFirst?: boolean;
};

type EditorialPageProps = {
  eyebrow: string;
  title: string;
  intro: string;
  sections: EditorialSection[];
  closing?: string;
};

export function EditorialPage({ eyebrow, title, intro, sections, closing }: EditorialPageProps) {
  return (
    <main className="bg-ivory text-charcoal">
      <StickyHeader />
      <section className="relative overflow-hidden border-b border-black/10 bg-ivory px-6 pb-20 pt-32 dark:border-white/10 md:px-10 md:pb-28 md:pt-44">
        <div className="mx-auto max-w-7xl">
          <p className="text-[0.65rem] uppercase tracking-[0.4em] text-gold">{eyebrow}</p>
          <h1 className="mt-8 max-w-5xl font-display text-[clamp(3.6rem,9vw,9rem)] leading-[0.82] tracking-[-0.055em]">{title}</h1>
          <p className="mt-10 max-w-2xl text-base leading-8 text-charcoal/65 md:text-lg">{intro}</p>
          <div className="mt-12 h-px w-full bg-gold/45" />
        </div>
      </section>

      <section className="mx-auto max-w-7xl space-y-24 px-6 py-20 md:space-y-36 md:px-10 md:py-28">
        {sections.map((section, index) => (
          <article key={section.title} className="grid gap-10 md:grid-cols-2 md:items-center md:gap-20">
            <div className={section.imageFirst ? 'order-2 md:order-1' : 'order-1'}>
              <p className="text-[0.62rem] uppercase tracking-[0.38em] text-gold">{section.eyebrow || `0${index + 1}`}</p>
              <h2 className="mt-5 max-w-xl font-display text-5xl leading-[0.9] tracking-[-0.04em] md:text-7xl">{section.title}</h2>
              <div className="my-8 h-px w-16 bg-gold" />
              <p className="max-w-xl text-sm leading-8 text-charcoal/68 md:text-base">{section.body}</p>
            </div>
            {section.image ? (
              <div className={section.imageFirst ? 'order-1 md:order-2' : 'order-2'}>
                <div className="relative aspect-[4/5] overflow-hidden bg-sand shadow-[0_20px_70px_rgba(42,38,34,0.08)]">
                  <img src={section.image} alt={section.imageAlt || section.title} className="h-full w-full object-cover" loading={index === 0 ? 'eager' : 'lazy'} />
                </div>
              </div>
            ) : null}
          </article>
        ))}
      </section>

      <section className="border-y border-gold/25 bg-sand/40 px-6 py-24 text-center md:px-10 md:py-36">
        <p className="mx-auto max-w-4xl font-display text-4xl leading-[0.95] tracking-[-0.04em] md:text-7xl">{closing || 'Designed with intention. Worn with feeling.'}</p>
        <Link href="/collections" className="mt-10 inline-flex items-center gap-4 border border-gold/70 px-6 py-4 text-[0.65rem] uppercase tracking-[0.3em] transition hover:bg-gold hover:text-ink">
          Explore collections <ArrowRight className="h-4 w-4" />
        </Link>
      </section>
      <Footer />
    </main>
  );
}
