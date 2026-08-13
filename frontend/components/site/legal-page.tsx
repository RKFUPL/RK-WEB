import Link from 'next/link';
import { Footer } from '@/components/home/footer';
import { StickyHeader } from '@/components/home/sticky-header';

export type LegalSection = { title: string; body: string };

export function LegalPage({ eyebrow, title, intro, updated = '[LAST UPDATED DATE]', sections }: { eyebrow: string; title: string; intro: string; updated?: string; sections: LegalSection[] }) {
  return (
    <main className="bg-ivory text-charcoal">
      <StickyHeader />
      <section className="border-b border-black/10 px-6 pb-16 pt-32 dark:border-white/10 md:px-10 md:pb-24 md:pt-44">
        <div className="mx-auto max-w-7xl">
          <p className="text-[0.65rem] uppercase tracking-[0.4em] text-gold">{eyebrow}</p>
          <h1 className="mt-7 max-w-4xl font-display text-[clamp(3.4rem,8vw,8rem)] leading-[0.84] tracking-[-0.055em]">{title}</h1>
          <p className="mt-8 max-w-2xl text-base leading-8 text-charcoal/65 md:text-lg">{intro}</p>
          <p className="mt-8 text-[0.65rem] uppercase tracking-[0.3em] text-charcoal/45">Last updated: {updated}</p>
          <div className="mt-10 h-px bg-gold/45" />
        </div>
      </section>
      <div className="mx-auto grid max-w-7xl gap-12 px-6 py-16 md:grid-cols-[15rem_1fr] md:px-10 md:py-24">
        <aside className="h-fit md:sticky md:top-28">
          <p className="text-[0.62rem] uppercase tracking-[0.38em] text-gold">Contents</p>
          <nav className="mt-5 flex flex-wrap gap-x-5 gap-y-3 md:block md:space-y-3">
            {sections.map((section, index) => <a key={section.title} href={`#section-${index + 1}`} className="block text-xs leading-5 text-charcoal/55 transition hover:text-gold">{String(index + 1).padStart(2, '0')} {section.title}</a>)}
          </nav>
        </aside>
        <div className="max-w-3xl divide-y divide-black/10 dark:divide-white/10">
          {sections.map((section, index) => (
            <section id={`section-${index + 1}`} key={section.title} className="scroll-mt-28 py-10 first:pt-0 last:pb-0">
              <p className="text-[0.62rem] uppercase tracking-[0.35em] text-gold">{String(index + 1).padStart(2, '0')}</p>
              <h2 className="mt-4 font-display text-4xl leading-none md:text-5xl">{section.title}</h2>
              <p className="mt-6 text-sm leading-8 text-charcoal/68 md:text-base">{section.body}</p>
            </section>
          ))}
          <p className="pt-10 text-sm leading-8 text-charcoal/55">Questions about this page? Contact <Link href="mailto:[CONTACT EMAIL]" className="text-gold underline-offset-4 hover:underline">[CONTACT EMAIL]</Link>.</p>
        </div>
      </div>
      <Footer />
    </main>
  );
}
