import Link from 'next/link';
import { Footer } from '@/components/home/footer';
import { StickyHeader } from '@/components/home/sticky-header';
import type { CollectionPage } from '@/lib/home-content';

type CollectionDetailPageProps = {
  collection: CollectionPage;
};

export function CollectionDetailPage({ collection }: CollectionDetailPageProps) {
  const collectionFontFace = collection.fontUrl
    ? `@font-face { font-family: "${collection.fontFamily}"; src: url("${collection.fontUrl}"); font-display: swap; }`
    : '';

  return (
    <main className="bg-ivory text-charcoal">
      {collectionFontFace ? <style dangerouslySetInnerHTML={{ __html: collectionFontFace }} /> : null}
      <StickyHeader />

      <section className="mx-auto max-w-7xl px-6 pb-16 pt-28 lg:px-10 lg:pb-24 lg:pt-32">
        <div className="grid gap-10 lg:grid-cols-[0.95fr_1.05fr] lg:items-start lg:gap-16">
          <div className="space-y-6 lg:sticky lg:top-32 lg:self-start">
            <p className="text-xs uppercase tracking-[0.38em] text-charcoal/45">{collection.status}</p>
            <h1
              className="max-w-xl text-[clamp(3.2rem,8vw,6.6rem)] leading-[0.9] tracking-[0.05em]"
              style={{ fontFamily: `${collection.fontFamily}, var(--font-display), serif` }}
            >
              {collection.name}
            </h1>
            <p className="max-w-xl text-base leading-8 text-charcoal/70 md:text-lg">
              {collection.summary}
            </p>
            <div className="flex flex-wrap gap-3 text-[0.68rem] uppercase tracking-[0.28em] text-charcoal/50">
              <span className="rounded-full border border-black/10 px-4 py-2">Editorial Preview</span>
              <span className="rounded-full border border-black/10 px-4 py-2">Luxury Womenswear</span>
            </div>
          </div>

          <div className="space-y-6">
            <div className="overflow-hidden border border-black/10 bg-white">
              <img
                src={collection.image}
                alt={collection.name}
                className="h-full w-full object-cover"
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="border border-black/10 bg-white px-6 py-6">
                <p className="text-[0.63rem] uppercase tracking-[0.35em] text-charcoal/40">Summary</p>
                <p className="mt-3 text-sm leading-7 text-charcoal/70">
                  This page can later become a CMS-driven collection story with lookbook imagery,
                  product edits, and editorial copy.
                </p>
              </div>
              <div className="border border-black/10 bg-white px-6 py-6">
                <p className="text-[0.63rem] uppercase tracking-[0.35em] text-charcoal/40">Next Step</p>
                <p className="mt-3 text-sm leading-7 text-charcoal/70">
                  We can easily expand this template with shopping links, gallery blocks, or a
                  launch countdown when you are ready.
                </p>
              </div>
            </div>

            <div className="flex justify-end">
              <Link
                href="/collections"
                className="inline-flex items-center gap-2 border border-black/10 px-5 py-3 text-xs uppercase tracking-[0.28em] transition hover:border-gold hover:text-gold"
              >
                Back to Collections
              </Link>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </main>
  );
}
