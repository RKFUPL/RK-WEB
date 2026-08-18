'use client';

import { ArrowDown } from 'lucide-react';
import { motion, useReducedMotion } from 'framer-motion';
import type { CSSProperties } from 'react';
import type { CollectionHeroConfig, ManagedCollection } from '@/lib/catalog';
import { cloudinaryImageUrl } from '@/lib/utils';

type CollectionHeroProps = {
  collection: Pick<ManagedCollection, 'name' | 'description' | 'season' | 'year' | 'designerNote' | 'collectionNumber' | 'location' | 'campaignInformation'>;
  hero: CollectionHeroConfig;
  titleStyle?: CSSProperties;
};

function HeroMedia({ hero }: { hero: CollectionHeroConfig }) {
  const reduceMotion = useReducedMotion();
  const fallbackImage = hero.poster || hero.image;
  const desktopImage = cloudinaryImageUrl(fallbackImage, 1920);
  const mobileImage = cloudinaryImageUrl(hero.mobileImage || fallbackImage, 900);
  const mediaStyle = {
    '--collection-hero-desktop-position': hero.desktopObjectPosition || 'center center',
    '--collection-hero-mobile-position': hero.mobileObjectPosition || hero.desktopObjectPosition || 'center center',
  } as CSSProperties;

  if (hero.type === 'video' && hero.video && !reduceMotion) {
    return <video autoPlay muted loop playsInline preload="metadata" poster={desktopImage || undefined} aria-label="Collection campaign film" className="collection-campaign-media" style={mediaStyle}>
      {hero.mobileVideo ? <source media="(max-width: 767px)" src={hero.mobileVideo} /> : null}
      <source src={hero.video} />
    </video>;
  }

  return fallbackImage ? <picture className="block h-full w-full">
    {hero.mobileImage ? <source media="(max-width: 767px)" srcSet={mobileImage} /> : null}
    <img src={desktopImage} alt="" role="presentation" loading="eager" fetchPriority="high" className="collection-campaign-media" style={mediaStyle} />
  </picture> : <div className="h-full w-full bg-sand" aria-hidden="true" />;
}

function Metadata({ collection, inverse }: { collection: CollectionHeroProps['collection']; inverse: boolean }) {
  const items = [
    ['Season', collection.season],
    ['Year', collection.year],
    ['No.', collection.collectionNumber],
    ['Location', collection.location],
    ['Campaign', collection.campaignInformation],
  ].filter((item): item is [string, string | number] => item[1] !== undefined && item[1] !== null && item[1] !== '');

  if (!items.length) return null;

  return <dl className={`collection-campaign-metadata ${inverse ? 'border-white/25 text-white/65' : 'border-black/15 text-[#2a2622]/60'}`}>
    {items.map(([label, value]) => <div key={label}><dt className="text-[0.5rem] uppercase tracking-[0.28em]">{label}</dt><dd className="mt-1 text-[0.68rem]">{value}</dd></div>)}
  </dl>;
}

function HeroCopy({ collection, hero, titleStyle }: CollectionHeroProps) {
  const inverse = hero.textTheme !== 'dark';
  const featureTitle = hero.titleScale === 'feature';

  return <motion.div
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.9, delay: 0.12, ease: [0.22, 1, 0.36, 1] }}
    className={`collection-campaign-copy ${inverse ? 'text-white' : 'text-[#211d19]'}`}
  >
    <p className={`text-[0.56rem] uppercase tracking-[0.42em] ${inverse ? 'text-white/72' : 'text-[#211d19]/60'}`}>{hero.label || 'The Collection'}</p>
    <h1 style={titleStyle} className={`collection-campaign-title${featureTitle ? ' collection-campaign-title--feature' : ''}`}>{collection.name}</h1>
    {collection.description ? <p className={`collection-campaign-description ${inverse ? 'text-white/82' : 'text-[#211d19]/72'}`}>{collection.description}</p> : null}
    {collection.designerNote ? <p className={`mt-3 max-w-lg font-display text-lg italic leading-6 ${inverse ? 'text-white/72' : 'text-[#211d19]/65'}`}>{collection.designerNote}</p> : null}
    <Metadata collection={collection} inverse={inverse} />
    <a href="#collection-products" className={`collection-campaign-cta ${inverse ? 'border-white/55 hover:border-white' : 'border-[#211d19]/35 hover:border-gold hover:text-gold'}`}>
      {hero.ctaLabel || 'Explore Collection'} <ArrowDown size={14} strokeWidth={1.5} />
    </a>
  </motion.div>;
}

export function CollectionHero({ collection, hero, titleStyle }: CollectionHeroProps) {
  const textPosition = hero.textPosition || 'left';
  const textTheme = hero.textTheme || 'light';

  return <section className={`collection-campaign-hero collection-campaign-hero--${textPosition} collection-campaign-hero--${textTheme}`}>
    <motion.div
      initial={{ opacity: 0, scale: 1.015 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
      className="absolute inset-0"
    >
      <HeroMedia hero={hero} />
    </motion.div>
    <div className="collection-campaign-hero__scrim" aria-hidden="true" />
    <div className={`collection-campaign-hero__content ${textPosition === 'right' ? 'justify-end' : 'justify-start'}`}>
      <HeroCopy collection={collection} hero={hero} titleStyle={titleStyle} />
    </div>
  </section>;
}
