import Link from 'next/link';
import { Footer } from '@/components/home/footer';
import { StickyHeader } from '@/components/home/sticky-header';
import { SectionShell } from '@/components/home/section-shell';
import { collectionPages } from '@/lib/home-content';

export default function CollectionsPage() {
  return (
    <main className="bg-ivory text-charcoal">
      <StickyHeader />

      <SectionShell className="pb-16 pt-28 lg:pb-24 lg:pt-32">
        <div className="grid gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
          <div className="space-y-6 lg:sticky lg:top-28 lg:self-start">
            <p className="text-xs uppercase tracking-[0.38em] text-charcoal/45">All Collections</p>
            <h1 className="max-w-xl font-display text-5xl leading-none md:text-7xl">
              A quiet archive of the house.
            </h1>
            <p className="max-w-xl text-base leading-8 text-charcoal/70 md:text-lg">
              A curated index of the house, laid out like a luxury editorial archive. Each
              collection now links to its own dedicated page.
            </p>
          </div>

          <div className="border-t border-black/10">
            {collectionPages.map((collection) => (
              <Link
                key={collection.name}
                href={collection.route}
                className="group block border-b border-black/10 py-7 transition duration-300 hover:bg-black/[0.03]"
              >
                <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between md:gap-8">
                  <div className="max-w-2xl">
                    <p className="text-[0.63rem] uppercase tracking-[0.35em] text-charcoal/40">
                      {collection.status}
                    </p>
                    <h2 className="mt-2 font-aakaar text-[clamp(2.2rem,7vw,4.6rem)] leading-[0.85] tracking-[0.04em] text-charcoal">
                      {collection.name}
                    </h2>
                    <p className="mt-3 max-w-xl text-sm leading-6 text-charcoal/62 md:text-base md:leading-7">
                      {collection.summary}
                    </p>
                  </div>

                  <div className="flex items-center gap-4 text-[0.65rem] uppercase tracking-[0.3em] text-charcoal/42">
                    <span className="hidden h-px w-12 bg-black/20 md:block" />
                    <span>{collection.name}</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </SectionShell>

      <Footer />
    </main>
  );
}
