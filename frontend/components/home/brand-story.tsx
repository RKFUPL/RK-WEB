import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { brandStory } from '@/lib/home-content';
import { SectionShell } from './section-shell';

export function BrandStory() {
  return (
    <SectionShell id="about" className="bg-ivory">
      <div className="grid gap-10 lg:grid-cols-[1fr_0.95fr] lg:items-center">
        <div className="space-y-8">
          <div className="space-y-4">
            <p className="text-xs uppercase tracking-[0.38em] text-charcoal/50">Brand Story</p>
            <h2 className="max-w-xl font-display text-5xl leading-[0.9] text-charcoal md:text-7xl">
              {brandStory.title}
            </h2>
            <p className="max-w-xl text-sm leading-7 text-charcoal/72 md:text-base">
              {brandStory.description}
            </p>
          </div>
          <Link
            href="/about-rk"
            className="inline-flex w-fit items-center gap-2 border border-black/10 bg-white px-6 py-3 text-xs uppercase tracking-[0.28em] text-charcoal transition hover:border-gold hover:text-gold"
          >
            {brandStory.cta}
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
        <div className="relative min-h-[28rem] overflow-hidden border border-black/6 bg-white">
          <Image
            src={brandStory.image}
            alt={brandStory.title}
            fill
            sizes="(max-width: 1024px) 100vw, 45vw"
            className="object-cover object-center"
          />
        </div>
      </div>
    </SectionShell>
  );
}
