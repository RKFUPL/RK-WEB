'use client';

import Image from 'next/image';
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useMemo, useRef, useState } from 'react';
import { aakarBannerBackgroundUrl, featuredCollection } from '@/lib/home-content';

const bannerFrames = [
  'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785488046/Rashi_Kapoor474_compressed_8000kb_pqcair.jpg',
  'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785488013/Rashi_Kapoor306_compressed_8000kb_vnw8a0.jpg',
  'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785487994/Rashi_Kapoor2418_compressed_8000kb_qkke56.jpg',
  'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785487943/Rashi_Kapoor187_compressed_8000kb_e5k7xn.jpg',
  'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785487885/Rashi_Kapoor1358_compressed_8000kb_1_iblkxd.jpg',
] as const;

function shuffle(source: readonly string[]) {
  const items = [...source];
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

export function FeaturedCollection() {
  const [order, setOrder] = useState<string[]>([...bannerFrames]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showImage, setShowImage] = useState(false);
  const [isVisible, setIsVisible] = useState(true);

  const timerRef = useRef<number | null>(null);

  const activeImage = useMemo(() => order[currentIndex], [currentIndex, order]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setShowImage(true);
    }, 1800);

    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const clearTimer = () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    const scheduleNext = () => {
      clearTimer();

      timerRef.current = window.setTimeout(() => {
        setCurrentIndex((current) => {
          const next = current + 1;
          if (next >= order.length) {
            setOrder(shuffle(bannerFrames));
            return 0;
          }
          return next;
        });

        if (document.hidden) {
          timerRef.current = null;
          return;
        }

        scheduleNext();
      }, 4800);
    };

    const handleVisibility = () => {
      setIsVisible(!document.hidden);
    };

    document.addEventListener('visibilitychange', handleVisibility);
    handleVisibility();

    if (showImage && isVisible) {
      scheduleNext();
    }

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      clearTimer();
    };
  }, [currentIndex, isVisible, order.length, showImage]);

  return (
    <section
      id="collections"
      className="relative overflow-hidden border-y border-black/6 bg-[#8a3d38]"
      style={{ marginTop: 'var(--rk-header-height, 0px)' }}
    >
      <div className="relative min-h-[38rem] lg:min-h-[calc(100svh-var(--rk-header-height,0px))]">
        <Image
          src={aakarBannerBackgroundUrl}
          alt="Aakaar textured banner background"
          fill
          priority
          sizes="100vw"
          className="object-cover object-center"
        />

        <AnimatePresence mode="sync" initial={false}>
          {showImage ? (
            <motion.div
              key={activeImage}
              className="absolute inset-0"
              initial={{ opacity: 0, clipPath: 'inset(0 100% 0 0)' }}
              animate={{ opacity: 1, clipPath: 'inset(0 0% 0 0)' }}
              exit={{ opacity: 0, clipPath: 'inset(0 0 0 100%)' }}
              transition={{ duration: 1.9, ease: [0.4, 0, 0.2, 1] }}
            >
              <Image
                src={activeImage}
                alt="Rashi Kapoor campaign imagery"
                fill
                priority={currentIndex === 0}
                sizes="100vw"
                className="object-cover object-center brightness-100 saturate-100 contrast-100"
              />
            </motion.div>
          ) : null}
        </AnimatePresence>

        <motion.div
          className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center px-6 text-center"
          style={{ color: '#ffffff' }}
          initial={false}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, ease: 'easeOut' }}
        >
          <motion.div
            className="flex flex-col items-center gap-3"
            initial={false}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, ease: 'easeOut' }}
          >
            <motion.h2
              className="font-aakaar text-[clamp(2.8rem,10vw,6.5rem)] leading-[0.9] tracking-[0.04em] drop-shadow-[0_1px_18px_rgba(0,0,0,0.2)]"
              style={{ color: '#e3cec4' }}
              initial={false}
              animate={{ opacity: 1, letterSpacing: '0.04em' }}
              transition={{ duration: 0.9, ease: 'easeOut' }}
            >
              AAKAAR
            </motion.h2>
            {showImage ? (
              <div className="mt-1 flex flex-col items-center gap-4">
                <motion.p
                  className="text-[clamp(0.68rem,1.8vw,0.92rem)] uppercase tracking-[0.46em]"
                  style={{ color: '#ffffff', opacity: 0.82 }}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 1.0, ease: 'easeOut', delay: 0.15 }}
                >
                  COMING SOON
                </motion.p>
                <motion.a
                  href="/collections/aakaar-insights"
                  className="pointer-events-auto inline-flex items-center justify-center border border-white/65 px-5 py-3 text-[0.7rem] uppercase tracking-[0.34em] text-white transition duration-300 hover:bg-black hover:text-white"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 1.0, ease: 'easeOut', delay: 0.28 }}
                >
                  {featuredCollection.cta}
                </motion.a>
              </div>
            ) : (
              <p
                className="text-[clamp(0.68rem,1.8vw,0.92rem)] uppercase tracking-[0.46em]"
                style={{ color: '#ffffff', opacity: 0.82 }}
              >
                COMING SOON
              </p>
            )}
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}
