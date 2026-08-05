import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { Footer } from '@/components/home/footer';
import { StickyHeader } from '@/components/home/sticky-header';
import { SectionShell } from '@/components/home/section-shell';
import { brandStory } from '@/lib/home-content';

const aboutSections = [
  {
    title: 'Craft with restraint',
    description:
      'The house is shaped by sculpted drape, fine surface work, and a quieter approach to occasion dressing.',
  },
  {
    title: 'Designed like an archive',
    description:
      'Every collection is treated as a chapter, building a visual language that feels editorial and enduring.',
  },
  {
    title: 'Made for the modern client',
    description:
      'The work balances luxury, movement, and ease so each piece feels elevated without losing wearability.',
  },
] as const;

export default function AboutRkPage() {
  return (
    <main className="bg-ivory text-charcoal">
      <StickyHeader />

      <section className="brand-story-section">
        <img
          src="https://res.cloudinary.com/fm1bwbrd/image/upload/v1785924919/download_vjn60l.png"
          alt=""
          aria-hidden="true"
          className="brand-story-backdrop brand-story-backdrop-light"
        />
        <img
          src="https://res.cloudinary.com/fm1bwbrd/image/upload/v1785924823/download_tvu6fp.png"
          alt=""
          aria-hidden="true"
          className="brand-story-backdrop brand-story-backdrop-dark"
        />

        <div className="relative z-10">
          <SectionShell className="pb-16 pt-28 lg:pb-24 lg:pt-32">
            <div className="grid gap-12 lg:grid-cols-[0.95fr_1.05fr] lg:items-start lg:gap-16">
          <div className="space-y-6 lg:sticky lg:top-32 lg:self-start">
            <p className="text-xs uppercase tracking-[0.38em] text-charcoal/45">About RK</p>
            <h1 className="max-w-xl font-display text-5xl leading-none md:text-7xl">
              The house behind the collection.
            </h1>
            <p className="max-w-xl text-base leading-8 text-charcoal/70 md:text-lg">
              {brandStory.description}
            </p>
            <Link
              href="/collections"
              className="inline-flex w-fit items-center gap-2 border border-black/10 bg-white px-6 py-3 text-xs uppercase tracking-[0.28em] text-charcoal transition hover:border-gold hover:text-gold"
            >
              View Collections
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>

          <div className="space-y-6">
            <div className="relative min-h-[30rem] overflow-hidden border border-black/6 bg-white">
              <Image
                src={brandStory.image}
                alt={brandStory.title}
                fill
                sizes="(max-width: 1024px) 100vw, 55vw"
                className="object-cover object-center"
                priority
              />
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              {aboutSections.map((section) => (
                <div key={section.title} className="border border-black/10 bg-white px-6 py-6">
                  <p className="text-[0.63rem] uppercase tracking-[0.35em] text-charcoal/40">
                    {section.title}
                  </p>
                  <p className="mt-3 text-sm leading-7 text-charcoal/70">{section.description}</p>
                </div>
              ))}
            </div>
          </div>
            </div>
          </SectionShell>
        </div>
      </section>

      <Footer />
    </main>
  );
}
