'use client';

import { useEffect, useState } from 'react';
import { categoryItems } from '@/lib/home-content';
import { fetchCatalogCollections } from '@/lib/catalog-client';
import { CategoryCard } from './category-card';

const hastakalaLookbookCover = '/api/lookbooks/hastakala/cover';

export function ShopCategories() {
  const [collectionRoutes, setCollectionRoutes] = useState<Record<string, string>>({});
  useEffect(() => {
    let active = true;
    void fetchCatalogCollections()
      .then((collections) => {
        if (!active) return;
        setCollectionRoutes(Object.fromEntries(collections.map((collection) => [collection.name.toLowerCase(), `/collections/${collection.slug}`])));
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);
  return (
    <section id="shop" className="shop-categories-section bg-ivory">
      <img
        src="https://res.cloudinary.com/fm1bwbrd/image/upload/v1785921051/7438eb66-a217-4bdd-9227-92112a02fc5c_hds45c.png"
        alt=""
        aria-hidden="true"
        className="shop-section-backdrop shop-section-backdrop-light"
      />
      <img
        src="https://res.cloudinary.com/fm1bwbrd/image/upload/v1785920821/download_trvdb5.png"
        alt=""
        aria-hidden="true"
        className="shop-section-backdrop shop-section-backdrop-dark"
      />

      <div className="relative z-10 mx-auto w-full max-w-[78rem] px-6 py-16 lg:px-10 lg:py-16">
        <div className="grid items-start gap-12 lg:grid-cols-[minmax(15rem,0.76fr)_minmax(0,1.24fr)] lg:gap-16">
          <div className="max-w-[24rem] space-y-7">
            <div className="flex items-center gap-4">
              <p className="text-[0.72rem] uppercase tracking-[0.38em] text-gold">All collections</p>
              <span className="h-px w-12 bg-gold/65" />
            </div>
            <h2 className="font-display text-[clamp(3.25rem,5vw,5.25rem)] leading-[0.92] tracking-[-0.04em] text-charcoal">
              Where the art of<br /> draping meets<br /><span className="whitespace-nowrap">timeless luxury.</span>
            </h2>
            <div className="flex items-center gap-3 text-gold" aria-hidden="true">
              <span className="h-px w-5 bg-gold/70" /><span className="text-base">✦</span><span className="h-px w-5 bg-gold/70" />
            </div>
            <p className="max-w-[22rem] text-base leading-7 text-charcoal/70">
              An expression of our design philosophy, where exquisite fabrics, rich textures and meticulous craftsmanship come together in a timeless narrative of elegance and artistry.
            </p>
            <a href="/collections" className="inline-flex items-center gap-5 border border-gold/65 px-5 py-3 text-[0.6rem] uppercase tracking-[0.27em] text-charcoal transition duration-300 hover:bg-gold hover:text-ink">
              View all collections <span className="text-base leading-none">→</span>
            </a>
          </div>

          <div className="collection-editorial-grid grid w-full max-w-[44rem] grid-cols-2 gap-4 sm:grid-cols-3 lg:justify-self-end">
            {categoryItems.map((item, index) => (
              <CategoryCard key={item.title} title={item.title} image={item.title === 'Hastakala' ? hastakalaLookbookCover : item.image} href={collectionRoutes[item.title.toLowerCase()] || item.href} index={index} comingSoon={item.comingSoon} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
