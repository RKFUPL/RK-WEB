'use client';

import { ArrowDown, ArrowLeft, ArrowRight, ArrowUpRight } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useEffect, useState, type CSSProperties } from 'react';
import type { CollectionHeroConfig, ManagedCollection } from '@/lib/catalog';
import { cloudinaryImageUrl } from '@/lib/utils';

type CollectionHeroProps = {
  collection: Pick<ManagedCollection, 'name' | 'description' | 'season' | 'year' | 'designerNote' | 'collectionNumber' | 'location' | 'campaignInformation'>;
  hero: CollectionHeroConfig;
  titleStyle?: CSSProperties;
  ctaHref?: string;
  ctaLabel?: string;
  onProductsClick?: () => void;
};

function HeroMedia({ hero }: { hero: CollectionHeroConfig }) {
  const reduceMotion = useReducedMotion();
  const slides = hero.type === 'image' ? (hero.images || []).filter((slide) => slide.image) : [];
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isVisible, setIsVisible] = useState(true);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const activeSlide = slides[currentIndex];
  const fallbackImage = hero.image || hero.poster;
  const desktopImage = cloudinaryImageUrl(activeSlide?.image || fallbackImage, 1920);
  const mobileImage = cloudinaryImageUrl(activeSlide?.mobileImage || activeSlide?.image || hero.mobileImage || fallbackImage, 900);
  const [mediaFailed, setMediaFailed] = useState(false);
  useEffect(() => { setCurrentIndex(0); setMediaFailed(false); }, [hero.type, hero.video, hero.image, slides.map((slide) => slide.id).join('|')]);
  useEffect(() => { setMediaFailed(false); }, [currentIndex, desktopImage, mobileImage]);
  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 767px)');
    const updateViewport = () => setIsMobileViewport(mediaQuery.matches);
    updateViewport();
    mediaQuery.addEventListener('change', updateViewport);
    return () => mediaQuery.removeEventListener('change', updateViewport);
  }, []);
  useEffect(() => {
    const updateVisibility = () => setIsVisible(!document.hidden);
    document.addEventListener('visibilitychange', updateVisibility);
    updateVisibility();
    return () => document.removeEventListener('visibilitychange', updateVisibility);
  }, []);
  useEffect(() => {
    if (slides.length < 2 || !isVisible || reduceMotion) return;
    const timer = window.setInterval(() => setCurrentIndex((current) => (current + 1) % slides.length), 5400);
    return () => window.clearInterval(timer);
  }, [slides.length, isVisible, reduceMotion]);
  const mediaStyle = {
    '--collection-hero-desktop-position': activeSlide?.desktopObjectPosition || hero.desktopObjectPosition || 'center center',
    '--collection-hero-mobile-position': activeSlide?.mobileObjectPosition || activeSlide?.desktopObjectPosition || hero.mobileObjectPosition || hero.desktopObjectPosition || 'center center',
  } as CSSProperties;
  const videoSource = isMobileViewport && hero.mobileVideo ? hero.mobileVideo : hero.video;
  const videoPoster = isMobileViewport ? mobileImage || desktopImage : desktopImage;

  if (mediaFailed || (!desktopImage && !(hero.type === 'video' && hero.video))) {
    return <div className="grid h-full w-full place-items-center bg-sand text-center text-[0.65rem] uppercase tracking-[0.22em] text-charcoal/45" role="img" aria-label="Collection image not configured">Collection image not configured</div>;
  }

  if (hero.type === 'video' && videoSource && !reduceMotion) {
    return <video key={videoSource} autoPlay muted loop playsInline preload="metadata" poster={videoPoster || undefined} aria-label="Collection campaign film" className="collection-campaign-media" style={mediaStyle} onLoadedMetadata={(event) => void event.currentTarget.play().catch(() => undefined)} onError={() => setMediaFailed(true)} src={videoSource} />;
  }

  if (!desktopImage) return <div className="h-full w-full bg-sand" aria-hidden="true" />;

  const picture = <picture className="block h-full w-full">
    {(activeSlide?.mobileImage || hero.mobileImage) ? <source media="(max-width: 767px)" srcSet={mobileImage} /> : null}
    <img src={desktopImage} alt={activeSlide?.alt || ''} role={activeSlide?.alt ? undefined : 'presentation'} loading="eager" fetchPriority="high" className="collection-campaign-media" style={mediaStyle} onLoad={() => setMediaFailed(false)} onError={() => setMediaFailed(true)} />
  </picture>;
  if (slides.length < 2) return picture;

  const changeSlide = (direction: -1 | 1) => {
    setMediaFailed(false);
    setCurrentIndex((current) => (current + direction + slides.length) % slides.length);
  };
  return <div className="relative h-full w-full">
    <AnimatePresence mode="sync" initial={false}>
      <motion.div key={activeSlide.id} className="absolute inset-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduceMotion ? 0 : 0.8 }}>
        {picture}
      </motion.div>
    </AnimatePresence>
    <button type="button" aria-label="Previous collection image" onClick={() => changeSlide(-1)} className="absolute left-5 top-1/2 z-20 flex h-12 w-12 -translate-y-1/2 items-center justify-center border border-white/60 bg-black/15 text-white backdrop-blur-sm"><ArrowLeft size={20} /></button>
    <div className="absolute bottom-6 left-1/2 z-20 flex -translate-x-1/2 gap-2" aria-label="Collection image navigation">
      {slides.map((slide, index) => <button key={slide.id} type="button" aria-label={`Show collection image ${index + 1}`} aria-current={index === currentIndex} onClick={() => { setMediaFailed(false); setCurrentIndex(index); }} className={`h-3 w-3 rounded-full border-2 border-white ${index === currentIndex ? 'bg-white' : 'bg-transparent'}`} />)}
    </div>
    <button type="button" aria-label="Next collection image" onClick={() => changeSlide(1)} className="absolute right-5 top-1/2 z-20 flex h-12 w-12 -translate-y-1/2 items-center justify-center border border-white/60 bg-black/15 text-white backdrop-blur-sm"><ArrowRight size={20} /></button>
  </div>;
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

function HeroCopy({ collection, hero, titleStyle, ctaHref, ctaLabel = 'VIEW LOOKBOOK', onProductsClick }: CollectionHeroProps) {
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
    <div className="collection-campaign-actions">
      {ctaHref ? <a href={ctaHref} target={ctaHref.startsWith('http') ? '_blank' : undefined} rel={ctaHref.startsWith('http') ? 'noopener noreferrer' : undefined} className="collection-campaign-button collection-campaign-button--primary">
        {ctaLabel} <ArrowUpRight aria-hidden="true" size={14} strokeWidth={1.5} />
      </a> : null}
      {onProductsClick ? <button type="button" onClick={onProductsClick} className={`collection-campaign-button collection-campaign-button--secondary ${inverse ? 'collection-campaign-button--light' : 'collection-campaign-button--dark'}`}>
        VIEW PRODUCTS <ArrowDown aria-hidden="true" size={14} strokeWidth={1.5} />
      </button> : null}
    </div>
  </motion.div>;
}

export function CollectionHero({ collection, hero, titleStyle, ctaHref, onProductsClick }: CollectionHeroProps) {
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
      <HeroCopy collection={collection} hero={hero} titleStyle={titleStyle} ctaHref={ctaHref} onProductsClick={onProductsClick} />
    </div>
  </section>;
}
