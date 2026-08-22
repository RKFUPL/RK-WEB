'use client';

import { runwayCollections } from '@/lib/home-content';
import { CategoryCard } from './category-card';

export function ExclusiveRunway() {
  const collection = runwayCollections[0];

  return (
    <aside aria-labelledby="exclusive-runway-title" className="w-full border-t border-gold/45 pt-10">
      <div className="flex items-start justify-between gap-4">
        <h3 id="exclusive-runway-title" className="max-w-[11ch] font-display text-[clamp(2.8rem,4.4vw,4.5rem)] leading-[0.94] tracking-[-0.035em] text-charcoal">The Runway collection</h3>
      </div>
      <div className="mt-10 max-w-[18rem]">
        <CategoryCard title={collection.name} category="Runway collection" image={collection.image} href={collection.href} comingSoon ctaLabel="View runway" />
      </div>
    </aside>
  );
}
