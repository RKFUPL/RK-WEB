import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { brandStory } from '@/lib/home-content';

export function BrandStory() {
  return (
    <section id="about" className="brand-story-section bg-ivory">
      <img
        src="https://res.cloudinary.com/fm1bwbrd/image/upload/v1785930123/d8de58e0-7866-4bbd-8867-492437e4a0a2_wlonjn.png"
        alt=""
        aria-hidden="true"
        className="brand-story-backdrop brand-story-backdrop-light"
      />
      <img
        src="https://res.cloudinary.com/fm1bwbrd/image/upload/v1785930253/ba920197-4968-4936-909f-447d9f64fdb3_seally.png"
        alt=""
        aria-hidden="true"
        className="brand-story-backdrop brand-story-backdrop-dark"
      />

      <div className="relative z-10 mx-auto w-full max-w-[90rem] px-6 py-24 lg:px-12 lg:py-36">
        <div className="grid gap-14 lg:grid-cols-[0.72fr_1.28fr] lg:items-center lg:gap-24">
        <div className="relative space-y-9 lg:pb-12">
          <div className="absolute -left-8 top-16 hidden -rotate-90 text-[0.55rem] uppercase tracking-[0.35em] text-gold/70 lg:block">Timeless · Elegant · Distinctive</div>
          <div className="space-y-6">
            <div className="flex items-center gap-4">
              <p className="text-[0.62rem] uppercase tracking-[0.38em] text-gold">Brand story</p>
              <span className="h-px w-16 bg-gold/60" />
            </div>
            <h2 className="max-w-xl font-display text-[clamp(3.5rem,6vw,6.8rem)] leading-[0.82] tracking-[-0.035em] text-charcoal">
              The House of<br /><em className="text-gold">Rashi Kapoor.</em>
            </h2>
            <p className="max-w-md font-display text-2xl leading-[1.2] text-charcoal/72 md:text-3xl">
              Where tradition meets craftsmanship, modern silhouettes emerge. Each creation is designed to feel timeless, and celebrated for generations.
            </p>
          </div>
          <Link
            href="/about"
            className="inline-flex w-fit items-center gap-4 border-b border-gold/70 pb-3 text-[0.62rem] uppercase tracking-[0.28em] text-charcoal transition hover:gap-6 hover:text-gold"
          >
            Read our story <ArrowRight className="h-4 w-4 text-gold" />
          </Link>
        </div>
        <div className="relative min-h-[30rem] overflow-visible border border-black/10 bg-white p-3 lg:min-h-[40rem]">
          <div className="absolute -bottom-5 -left-5 hidden h-24 w-24 border-b border-l border-gold lg:block" />
          <div className="absolute -right-4 -top-4 h-20 w-20 border-r border-t border-gold/80" />
          <div className="relative h-full min-h-[28rem] overflow-hidden bg-sand lg:min-h-[37.5rem]">
          <Image
            src={brandStory.image}
            alt={brandStory.title}
            fill
            sizes="(max-width: 1024px) 100vw, 45vw"
            className="object-cover object-center transition duration-[1400ms] hover:scale-[1.04]"
          />
            <div className="absolute inset-0 bg-gradient-to-t from-[#1a120f]/25 to-transparent" />
          </div>
        </div>
        </div>
      </div>
    </section>
  );
}
