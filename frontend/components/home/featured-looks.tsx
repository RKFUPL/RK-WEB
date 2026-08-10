import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { lookbookCovers } from '@/lib/home-content';
import { SectionShell } from './section-shell';

export function FeaturedLooks() {
  return (
    <SectionShell id="lookbook" className="lookbook-feature-section">
      <div className="lookbook-feature-layout">
        <div className="lookbook-feature-copy">
          <p className="text-[0.65rem] uppercase tracking-[0.38em] text-gold">RK Lookbooks</p>
          <h2 className="mt-9 max-w-[23rem] font-display text-[clamp(2.65rem,3.7vw,4rem)] leading-[0.98] tracking-[-0.035em] text-charcoal">
            Stories told through silhouette and movement.
          </h2>
          <span className="mt-9 block h-px w-12 bg-gold/75" />
          <p className="mt-8 max-w-[20rem] text-sm leading-6 text-charcoal/70">
            Each lookbook is a reflection of our design philosophy—where every silhouette moves with intention and every detail tells a story.
          </p>
          <Link href="/rk-lookbooks" className="mt-10 inline-flex items-center gap-5 border-b border-gold/70 pb-3 text-[0.65rem] uppercase tracking-[0.3em] text-charcoal transition hover:text-gold">
            Explore all lookbooks <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        <div className="lookbook-editorial-collage">
          {lookbookCovers.map((look, index) => (
            <Link
              key={look.title}
              href={look.href}
              className="lookbook-collage-card group relative block overflow-hidden bg-white"
            >
              <Image
                src={look.image}
                alt={`${look.title} lookbook`}
                fill
                sizes="(max-width: 639px) 78vw, (max-width: 1023px) 44vw, 24vw"
                className="object-cover object-center transition duration-700 group-hover:scale-[1.035]"
              />
              <div className="absolute inset-x-0 bottom-0 flex items-end gap-3 bg-[#2b201b]/82 px-3 py-3 text-ivory backdrop-blur-[1px]">
                <span className="text-[0.52rem] tracking-[0.25em] text-gold/85">{String(index + 1).padStart(2, '0')}</span>
                <div>
                  <p className="text-[0.61rem] uppercase tracking-[0.25em]">{look.title}</p>
                  <p className="mt-1 text-[0.5rem] uppercase tracking-[0.27em] text-ivory/68">Lookbook</p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
      <div className="lookbook-ornament" aria-hidden="true"><span />✿<span /></div>
    </SectionShell>
  );
}
