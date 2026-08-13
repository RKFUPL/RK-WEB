'use client';

import Image from 'next/image';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import { aakarBannerBackgroundUrl } from '@/lib/home-content';

const bannerFrames = [
  { src: 'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785488046/Rashi_Kapoor474_compressed_8000kb_pqcair.jpg', label: 'Aakaar' },
  { src: 'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785488013/Rashi_Kapoor306_compressed_8000kb_vnw8a0.jpg', label: 'Aakaar' },
  { src: 'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785487994/Rashi_Kapoor2418_compressed_8000kb_qkke56.jpg', label: 'Aakaar' },
  { src: 'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785487943/Rashi_Kapoor187_compressed_8000kb_e5k7xn.jpg', label: 'Aakaar' },
  { src: 'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785487885/Rashi_Kapoor1358_compressed_8000kb_1_iblkxd.jpg', label: 'Aakaar' },
] as const;

const lineRevealStart = 'polygon(100% 0%, 100% 100%, 100% 100%, 100% 0%)';
const lineRevealEnd = 'polygon(0% 0%, 0% 100%, 100% 100%, 100% 0%)';

type HeroPhase = 0 | 1;

const titlePositions = {
  0: { left: '50%', top: '50%', x: '-50%', y: '-50%', scale: 1, opacity: 1 },
  1: { left: '5%', top: '49%', x: '0%', y: '0%', scale: 0.9, opacity: 0.96 },
} as const;

export function FeaturedCollection() {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [rotationReset, setRotationReset] = useState(0);
  const [isVisible, setIsVisible] = useState(true);
  const [phase, setPhase] = useState<HeroPhase>(0);
  const activeFrame = bannerFrames[currentIndex];

  const selectFrame = (index: number) => {
    setCurrentIndex(index);
    setRotationReset((current) => current + 1);
  };

  const changeFrame = (direction: -1 | 1) => {
    setCurrentIndex((current) => (current + direction + bannerFrames.length) % bannerFrames.length);
    setRotationReset((reset) => reset + 1);
  };

  useEffect(() => {
    const settleTimer = window.setTimeout(() => setPhase(1), 1900);

    return () => window.clearTimeout(settleTimer);
  }, []);

  useEffect(() => {
    const handleVisibility = () => setIsVisible(!document.hidden);
    document.addEventListener('visibilitychange', handleVisibility);
    handleVisibility();
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  useEffect(() => {
    if (!isVisible || phase === 0) return;

    const timer = window.setInterval(() => {
      setCurrentIndex((current) => (current + 1) % bannerFrames.length);
    }, 5400);

    return () => window.clearInterval(timer);
  }, [isVisible, phase, rotationReset]);

  return (
    <section id="collections" className="relative overflow-hidden border-y border-black/6 bg-[#8a3d38] text-white">
      <div className="relative min-h-[34rem] overflow-hidden lg:min-h-[calc(100svh-1.5rem)]">
        <Image
          src={aakarBannerBackgroundUrl}
          alt="Aakaar textured banner background"
          fill
          priority
          sizes="100vw"
          className="object-cover object-center"
        />

        <AnimatePresence mode="sync" initial={false}>
          {phase > 0 ? (
            <motion.div
              key={activeFrame.src}
              className="absolute inset-0 overflow-hidden"
              initial={{ opacity: 1, scale: 1.02, clipPath: lineRevealStart }}
              animate={{
                opacity: 1,
                scale: 1,
                clipPath: [lineRevealStart, lineRevealEnd],
              }}
              exit={{ opacity: 0, scale: 1.02 }}
              transition={{
                opacity: { duration: 1.6, ease: [0.4, 0, 0.2, 1] },
                scale: { duration: 1.8, ease: [0.22, 1, 0.36, 1] },
                clipPath: { duration: 1.8, ease: [0.22, 1, 0.36, 1] },
              }}
            >
              <Image
                src={activeFrame.src}
                alt={`Rashi Kapoor ${activeFrame.label} campaign`}
                fill
                priority={currentIndex === 0}
                sizes="100vw"
                className="object-cover object-center"
              />
            </motion.div>
          ) : null}
        </AnimatePresence>

        {phase > 0 ? <>
          <button type="button" aria-label="Previous Aakaar image" onClick={() => changeFrame(-1)} className="pointer-events-auto absolute left-5 top-1/2 z-40 flex h-12 w-12 -translate-y-1/2 items-center justify-center border border-[#fff1df]/55 bg-black/10 text-[#fff1df] backdrop-blur-sm transition hover:border-gold hover:bg-gold hover:text-ink lg:left-8"><ArrowLeft className="h-5 w-5" /></button>
          <div className="pointer-events-auto absolute bottom-5 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 lg:bottom-8" aria-label="Aakaar image navigation">
            {bannerFrames.map((frame, index) => <button key={frame.src} type="button" aria-label={`Show Aakaar image ${index + 1}`} aria-current={index === currentIndex} onClick={() => selectFrame(index)} className={`h-3 w-3 rounded-full border-2 border-[#fff1df]/90 transition ${index === currentIndex ? 'scale-125 bg-[#fff1df]' : 'bg-transparent hover:bg-[#fff1df]/70'}`} />)}
          </div>
          <button type="button" aria-label="Next Aakaar image" onClick={() => changeFrame(1)} className="pointer-events-auto absolute right-5 top-1/2 z-40 flex h-12 w-12 -translate-y-1/2 items-center justify-center border border-[#fff1df]/55 bg-black/10 text-[#fff1df] backdrop-blur-sm transition hover:border-gold hover:bg-gold hover:text-ink lg:right-8"><ArrowRight className="h-5 w-5" /></button>
        </> : null}

        <div className="pointer-events-none absolute inset-x-6 top-28 z-20 flex items-start justify-between text-[0.58rem] uppercase tracking-[0.34em] text-[#fff1df]/75 lg:inset-x-12 lg:top-36">
          <span>Rashi Kapoor / 2026</span>
          <span className="hidden items-center gap-3 md:flex"><span className="h-px w-10 bg-gold/70" />Indian couture</span>
        </div>

        <motion.div
          className="pointer-events-none absolute z-30 whitespace-nowrap"
          initial={titlePositions[0]}
          animate={titlePositions[phase]}
          transition={{
            duration: 1.8,
            ease: [0.22, 1, 0.36, 1],
          }}
        >
          <h1 className="font-aakaar text-[clamp(4rem,13vw,11rem)] leading-[0.78] tracking-[0.04em] text-[#fff1df] drop-shadow-[0_1px_22px_rgba(0,0,0,0.2)]">
            AAKAAR
          </h1>
        </motion.div>

        <AnimatePresence mode="wait">
          {phase === 0 ? (
            <motion.p
              key="intro-copy"
              className="pointer-events-none absolute inset-x-0 top-[58%] z-30 text-center text-[0.68rem] uppercase tracking-[0.46em] text-[#fff1df]/80"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.5, delay: 0.35 }}
            >
              Coming soon
            </motion.p>
          ) : (
            <motion.div
              key="settled-copy"
              className="pointer-events-none absolute inset-x-6 bottom-12 z-20 flex items-end justify-between gap-8 lg:inset-x-12 lg:bottom-20"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.35, ease: [0.22, 1, 0.36, 1] }}
            >
              <div>
                <p className="max-w-xs font-display text-xl leading-[1.05] text-[#fff1df]/90 md:text-2xl">
                  Timeless elegance.<br /><em className="text-gold">Modern luxury.</em>
                </p>
                <div className="mt-7 flex flex-wrap items-center gap-5">
                  <p className="text-[clamp(0.6rem,1.2vw,0.78rem)] uppercase tracking-[0.42em] text-[#fff1df]/85">Coming soon</p>
                  <a href="/collections/aakaar-insights" className="pointer-events-auto inline-flex items-center justify-center border border-gold/70 px-5 py-3 text-[0.62rem] uppercase tracking-[0.28em] text-[#fff1df] transition duration-500 hover:bg-gold hover:text-ink">
                    Explore Aakaar <span className="ml-3 text-base">→</span>
                  </a>
                </div>
              </div>

              <div className="hidden max-w-[10rem] border-l border-gold/60 pl-5 text-[0.57rem] uppercase leading-[1.8] tracking-[0.25em] text-[#fff1df]/65 md:block">
                <span className="text-gold">A new chapter</span><br />in movement,<br />texture &amp;<br />quiet couture.
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </section>
  );
}
