import Image from 'next/image';
import { featuredLooks } from '@/lib/home-content';
import { SectionShell } from './section-shell';
import { cn } from '@/lib/utils';

export function FeaturedLooks() {
  return (
    <SectionShell id="lookbook">
      <div className="max-w-2xl space-y-4">
        <p className="text-xs uppercase tracking-[0.38em] text-charcoal/50">Featured Looks</p>
        <h2 className="font-display text-4xl leading-none text-charcoal md:text-6xl">
          Editorial compositions with room to breathe.
        </h2>
      </div>
      <div className="mt-10 grid auto-rows-[16rem] gap-5 lg:grid-cols-12 lg:auto-rows-[12rem]">
        {featuredLooks.map((look) => (
          <article
            key={look.title}
            className={cn('group relative overflow-hidden bg-white shadow-[0_16px_40px_rgba(18,18,18,0.05)]', look.span)}
          >
            <Image
              src={look.image}
              alt={look.title}
              fill
              sizes="(max-width: 1024px) 100vw, 33vw"
              className="object-cover object-center transition duration-700 group-hover:scale-[1.04]"
            />
            <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(248,246,242,0)_0%,rgba(18,18,18,0.18)_100%)]" />
            <div className="absolute inset-x-0 bottom-0 p-5 text-ivory">
              <p className="text-[0.64rem] uppercase tracking-[0.35em] text-ivory/70">{look.title}</p>
              <p className="mt-2 max-w-xs text-sm leading-6">{look.caption}</p>
            </div>
          </article>
        ))}
      </div>
    </SectionShell>
  );
}
