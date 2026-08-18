'use client';

import Link from 'next/link';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { motion } from 'framer-motion';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Footer } from '@/components/home/footer';
import { StickyHeader } from '@/components/home/sticky-header';
import { SectionShell } from '@/components/home/section-shell';
import { aakarBannerBackgroundUrl, collectionPages, sortByCollectionOrder } from '@/lib/home-content';

type Lookbook = {
  title: string;
  subtitle: string;
  description: string;
  href?: string;
  comingSoon?: boolean;
};

const lookbooks: Lookbook[] = sortByCollectionOrder([
  { title: 'Aakaar', subtitle: 'The debut chapter is arriving soon.', description: 'A forthcoming Aakaar lookbook shaped by sculpted drape, quiet couture, and the first story of the house.', comingSoon: true },
  { title: 'Hastakala', subtitle: 'A craft-first presentation.', description: 'Reserved for hand-finished stories, artisan detail, and heirloom-inspired styling.', href: '/rk-lookbooks/hasthkala' },
  { title: 'Inaara', subtitle: 'A luminous, celebratory chapter.', description: 'A lookbook shaped by fluid lines, occasion dressing, and a softer sense of radiance.', href: '/rk-lookbooks/inaara' },
  { title: 'Anamika', subtitle: 'A softer, more movement-led chapter.', description: 'An evolving lookbook space for future drops, references, and campaign imagery.', href: '/rk-lookbooks/anamika' },
  { title: 'Naqab', subtitle: 'A veiled, dramatic visual chapter.', description: 'Layered silhouettes, evening presence, and a cinematic study in concealment and reveal.', href: '/rk-lookbooks/naqab' },
  { title: 'Sandook', subtitle: 'A treasured archive of the house.', description: 'A visual story of heirloom moods, considered detail, and timeless occasion dressing.', href: '/rk-lookbooks/sandook' },
], (lookbook) => lookbook.title);

const coverByTitle = new Map([
  ...collectionPages.map((collection) => [collection.name.toUpperCase(), collection.image] as const),
  ['ANAMIKA', 'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785861902/Anamika_ojeh19.png'],
  ['HASTAKALA', 'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785862112/Hastakala_kcb6la.png'],
  ['INAARA', 'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785861901/Inaara_hn30rg.png'],
  ['SANDOOK', 'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785861901/Sandook_h0rfqg.png'],
  ['AAKAAR', aakarBannerBackgroundUrl],
]);

const lookbookExploreLightBackground = 'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785934366/174c6b2b-830d-47ab-b2f7-27ff728c5384_ybxqdk.png';
const lookbookExploreDarkBackground = 'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785934628/5ffc37c0-a1a9-49ec-83e8-90c425fdd1ec_gk6csn.png';

const featuredLookbooks = lookbooks.filter((lookbook) => !lookbook.comingSoon && lookbook.href && coverByTitle.has(lookbook.title.toUpperCase()));

function titleStyle() {
  return {
    fontFamily: 'var(--font-display)',
    fontSize: 'clamp(1.8rem, 3.8vw, 3rem)',
  };
}

export default function RkLookbooksPage() {
  const initialIndex = Math.max(0, featuredLookbooks.findIndex((lookbook) => lookbook.title.toUpperCase() === 'INAARA'));
  const [spotlightIndex, setSpotlightIndex] = useState(initialIndex);
  const [paused, setPaused] = useState(false);
  const shelfRef = useRef<HTMLDivElement | null>(null);
  const activeSpotlight = featuredLookbooks[spotlightIndex] ?? featuredLookbooks[0];
  const activeCover = useMemo(() => coverByTitle.get(activeSpotlight?.title.toUpperCase()), [activeSpotlight]);

  useEffect(() => {
    if (paused) return;
    const timer = window.setInterval(() => setSpotlightIndex((current) => (current + 1) % featuredLookbooks.length), 6000);
    return () => window.clearInterval(timer);
  }, [paused]);

  useEffect(() => {
    const shelf = shelfRef.current;
    if (!shelf) return;
    const handleWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaX) <= Math.abs(event.deltaY) || event.deltaX === 0) return;
      event.preventDefault();
      shelf.scrollLeft += event.deltaX;
    };
    shelf.addEventListener('wheel', handleWheel, { passive: false });
    return () => shelf.removeEventListener('wheel', handleWheel);
  }, []);

  const changeSpotlight = (direction: -1 | 1) => setSpotlightIndex((current) => (current + direction + featuredLookbooks.length) % featuredLookbooks.length);

  const scrollShelf = (direction: -1 | 1) => shelfRef.current?.scrollBy({ left: direction * 310, behavior: 'smooth' });

  return (
    <main className="rk-lookbooks-archive bg-ivory text-charcoal">
      <StickyHeader />
      <SectionShell className="pb-0 pt-28 lg:pb-0 lg:pt-36">
        <section className="grid gap-12 lg:grid-cols-[0.72fr_1.28fr] lg:items-center lg:gap-20">
          <div className="max-w-xl space-y-6 lg:sticky lg:top-28 lg:self-start">
            <p className="text-xs uppercase tracking-[0.38em] text-charcoal/45">RK Lookbooks</p>
            <h1 className="max-w-lg font-display text-6xl leading-[0.9] md:text-8xl">An editorial archive of the house.</h1>
            <p className="max-w-md text-sm leading-7 text-charcoal/60 md:text-base md:leading-8">A considered collection of campaign imagery, references, and visual stories from the house of Rashi Kapoor.</p>
          </div>

          {activeSpotlight ? <div className="relative mx-auto w-full max-w-[31rem]" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
            <Link href={activeSpotlight.href ?? '/rk-lookbooks'} target={activeSpotlight.href ? '_blank' : undefined} rel={activeSpotlight.href ? 'noopener noreferrer' : undefined} className="group relative block aspect-[3/4] overflow-hidden rounded-[14px] bg-black">
              <motion.img key={activeSpotlight.title} src={activeCover} alt={`${activeSpotlight.title} lookbook cover`} className="absolute inset-0 h-full w-full object-cover" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.7, ease: 'easeOut' }} />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-black/10 transition duration-500 group-hover:from-black/85" />
              <motion.div key={`${activeSpotlight.title}-copy`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.7, delay: 0.1 }} className="absolute inset-x-0 bottom-0 z-30 p-7 text-white md:p-10">
                <p className="text-[0.6rem] uppercase tracking-[0.38em] text-white/60">Featured lookbook</p>
                <h2 style={titleStyle()} className="mt-4 leading-[0.82] tracking-[0.025em]">{activeSpotlight.title}</h2>
                <p className="mt-5 text-[0.65rem] uppercase tracking-[0.32em] text-white/65">Spring Summer 2026</p>
                <p className="mt-4 max-w-md text-sm leading-6 text-white/75">{activeSpotlight.description}</p>
                <span className="mt-7 inline-flex items-center gap-3 text-[0.62rem] uppercase tracking-[0.3em]">Read lookbook <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1.5" /></span>
              </motion.div>
            </Link>
            <button type="button" aria-label="Previous featured lookbook" onClick={() => changeSpotlight(-1)} className="absolute left-5 top-1/2 z-40 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full border border-white/40 bg-black/15 text-white backdrop-blur-sm transition hover:bg-black/35"><ArrowLeft className="h-5 w-5" /></button>
            <button type="button" aria-label="Next featured lookbook" onClick={() => changeSpotlight(1)} className="absolute right-5 top-1/2 z-40 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full border border-white/40 bg-black/15 text-white backdrop-blur-sm transition hover:bg-black/35"><ArrowRight className="h-5 w-5" /></button>
            <div className="absolute bottom-5 left-1/2 z-40 flex -translate-x-1/2 gap-2" aria-label="Lookbook spotlight navigation">{featuredLookbooks.map((lookbook, index) => <button key={lookbook.title} type="button" aria-label={`Show ${lookbook.title}`} onClick={() => setSpotlightIndex(index)} className={`h-1.5 w-1.5 rounded-full border border-white transition ${index === spotlightIndex ? 'bg-white' : 'bg-transparent'}`} />)}</div>
          </div> : null}
        </section>

        <section className="lookbook-explore-section relative left-1/2 mt-28 w-screen -translate-x-1/2 px-0 py-10 pb-24 md:mt-40">
          <div className="mx-auto w-full max-w-7xl px-6 md:px-10">
          <div className="flex items-end justify-between border-b border-black/15 pb-5"><div><p className="text-xs uppercase tracking-[0.38em] text-charcoal/45">The archive</p><h2 className="mt-3 font-display text-5xl leading-none md:text-7xl">Explore all lookbooks</h2></div><div className="hidden items-center gap-3 md:flex"><button type="button" aria-label="Scroll archive left" onClick={() => scrollShelf(-1)} className="flex h-10 w-10 items-center justify-center border border-black/15 transition hover:border-charcoal"><ArrowLeft className="h-4 w-4" /></button><button type="button" aria-label="Scroll archive right" onClick={() => scrollShelf(1)} className="flex h-10 w-10 items-center justify-center border border-black/15 transition hover:border-charcoal"><ArrowRight className="h-4 w-4" /></button></div></div>
          <div ref={shelfRef} className="rk-archive-shelf mt-12 flex gap-8 overflow-x-auto overscroll-x-contain pb-8 touch-pan-x select-none md:gap-10">
            {lookbooks.map((lookbook, index) => {
              const cover = coverByTitle.get(lookbook.title.toUpperCase());
              const card = <div className={`group relative w-[16rem] shrink-0 pt-4 text-left before:absolute before:left-0 before:right-0 before:top-0 before:h-px before:origin-left before:scale-x-0 before:bg-gold before:transition-transform before:duration-150 before:ease-out group-hover:before:scale-x-100 md:w-[17rem] ${activeSpotlight?.title === lookbook.title ? 'before:scale-x-100' : ''}`}>
                <div className="relative aspect-[3/4] w-full overflow-hidden rounded-[14px] bg-sand">
                  {cover ? <img src={cover} alt={`${lookbook.title} cover`} draggable={false} className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03] group-hover:brightness-90" /> : null}
                  {lookbook.comingSoon ? <div className="absolute inset-0 grid place-items-center bg-black/15"><span className="px-4 py-3 text-center text-[0.62rem] uppercase tracking-[0.35em] text-white drop-shadow-[0_1px_10px_rgba(0,0,0,.65)]">Coming<br />Soon</span></div> : null}
                  <span className="absolute left-4 top-4 font-display text-3xl text-white/80 drop-shadow">{String(index + 1).padStart(2, '0')}</span>
                </div>
                <h3 style={titleStyle()} className="mt-6 min-h-[3.5rem] whitespace-normal break-words text-3xl leading-[0.88] text-charcoal transition-colors duration-150 group-hover:text-gold">{lookbook.title}</h3>
                <p className="mt-3 text-[0.6rem] uppercase tracking-[0.32em] text-charcoal/45 transition-colors duration-150 group-hover:text-gold">{lookbook.comingSoon ? 'Coming soon' : 'SS26'}</p>
                <p className="mt-4 max-w-[16rem] text-sm leading-6 text-charcoal/60 transition-colors duration-150 group-hover:text-gold">{lookbook.description}</p>
                <span className="mt-6 inline-flex items-center gap-3 text-[0.6rem] uppercase tracking-[0.3em] text-charcoal/65 transition-colors duration-150 group-hover:text-gold md:opacity-0 md:group-hover:opacity-100">{lookbook.comingSoon ? 'Coming soon' : <>Read lookbook <ArrowRight className="h-3.5 w-3.5 transition-transform duration-300 group-hover:translate-x-1.5" /></>}</span>
              </div>;
              return lookbook.comingSoon ? <div key={lookbook.title} aria-label="Aakaar lookbook coming soon">{card}</div> : <Link key={lookbook.title} href={lookbook.href!} target="_blank" rel="noopener noreferrer">{card}</Link>;
            })}
          </div>
          </div>
        </section>
      </SectionShell>
      <Footer />
      <style jsx>{`.rk-archive-shelf { scrollbar-width: none; cursor: grab; } .rk-archive-shelf::-webkit-scrollbar { display: none; } .rk-archive-shelf:active { cursor: grabbing; } .rk-archive-shelf.is-dragging { cursor: grabbing; } .lookbook-explore-section { background-image: url("${lookbookExploreLightBackground}"); background-position: center; background-repeat: no-repeat; background-size: 100% 100%; } :global(.dark) .lookbook-explore-section { background-image: url("${lookbookExploreDarkBackground}"); }`}</style>
    </main>
  );
}
