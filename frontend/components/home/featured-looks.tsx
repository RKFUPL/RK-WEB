'use client';

import { useEffect, useRef, useState } from 'react';
import { lookbookCovers } from '@/lib/home-content';

const VIDEO_SRC = 'https://res.cloudinary.com/fm1bwbrd/video/upload/v1786389568/RK_LFW_EDIT_1_-compressed_sefgri.mp4';
const VIDEO_POSTER = lookbookCovers[0].image;
const VIDEO_POSITION_DESKTOP = 'center center';
const VIDEO_POSITION_MOBILE = 'center center';

const VIDEO_SCENES = lookbookCovers.map((look, index) => ({
  title: String(index + 1).padStart(2, '0'),
  name: look.title,
  thumbnail: look.image,
  start: index * 4,
  end: (index + 1) * 4,
}));

export function FeaturedLooks() {
  const sectionRef = useRef<HTMLElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [activeScene, setActiveScene] = useState(0);
  const [ready, setReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isInView, setIsInView] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    const section = sectionRef.current;
    const video = videoRef.current;
    if (!section || !video) return;

    const play = () => {
      if (reducedMotion) return;
      void video.play().catch(() => undefined);
    };
    const pause = () => video.pause();
    const observer = new IntersectionObserver(([entry]) => {
      const visible = entry.isIntersecting && entry.intersectionRatio >= 0.5;
      setIsInView(visible);
      if (visible) play();
      else if (!entry.isIntersecting || entry.intersectionRatio < 0.2) pause();
    }, { threshold: [0.2, 0.5, 0.75] });

    observer.observe(section);
    return () => observer.disconnect();
  }, [reducedMotion]);

  const updateScene = () => {
    const video = videoRef.current;
    if (!video) return;
    const index = VIDEO_SCENES.findIndex((scene) => video.currentTime >= scene.start && video.currentTime < scene.end);
    if (index >= 0) setActiveScene(index);
    else if (video.currentTime >= VIDEO_SCENES[VIDEO_SCENES.length - 1].start) setActiveScene(VIDEO_SCENES.length - 1);
  };

  const seekToScene = (index: number) => {
    const video = videoRef.current;
    const scene = VIDEO_SCENES[index];
    if (!video || !scene) return;
    video.currentTime = scene.start;
    setActiveScene(index);
    if (!reducedMotion) void video.play().catch(() => undefined);
  };

  return (
    <section ref={sectionRef} id="lookbook" aria-label="Rashi Kapoor fashion film" className="relative isolate h-[100svh] min-h-[38rem] overflow-hidden bg-ink text-ivory">
      <video
        ref={videoRef}
        autoPlay={!reducedMotion}
        muted
        playsInline
        loop
        preload="auto"
        poster={VIDEO_POSTER}
        onLoadedData={() => setReady(true)}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onTimeUpdate={updateScene}
        aria-label="Rashi Kapoor fashion film"
        className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-1000 ${ready ? 'opacity-100' : 'opacity-0'}`}
        style={{ objectPosition: `var(--video-position-desktop, ${VIDEO_POSITION_DESKTOP})` }}
      >
        <source src={VIDEO_SRC} type="video/mp4" />
      </video>

      <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/5 to-black/10" aria-hidden="true" />
      <div className="absolute left-6 top-24 z-10 text-[0.6rem] uppercase tracking-[0.38em] text-white/75 lg:left-12 lg:top-32">RK Films</div>

      {!ready ? <div className="absolute inset-0 z-20 grid place-items-center text-[0.6rem] uppercase tracking-[0.38em] text-white/65">Loading film</div> : null}
      {ready && isInView && !isPlaying && !reducedMotion ? <button type="button" onClick={() => { const video = videoRef.current; if (video) void video.play().catch(() => undefined); }} className="absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2 border border-white/65 bg-black/25 px-6 py-3 text-[0.6rem] uppercase tracking-[0.35em] text-white backdrop-blur-sm transition hover:border-gold hover:bg-gold hover:text-ink">Play film</button> : null}

      <div className="absolute inset-x-4 bottom-5 z-20 flex items-end justify-center lg:inset-x-12 lg:bottom-8">
        <div className="flex max-w-full gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="tablist" aria-label="Fashion film scenes">
          {VIDEO_SCENES.map((scene, index) => (
            <button
              key={scene.title}
              type="button"
              role="tab"
              aria-selected={index === activeScene}
              aria-label={`Play scene ${scene.title}, ${scene.name}`}
              onClick={() => seekToScene(index)}
              className={`group relative h-16 w-11 shrink-0 overflow-hidden border transition duration-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold sm:h-20 sm:w-14 ${index === activeScene ? 'scale-105 border-gold opacity-100' : 'border-white/35 opacity-60 hover:opacity-95'}`}
            >
              <img src={scene.thumbnail} alt="" className="h-full w-full object-cover" loading="lazy" />
              <span className="absolute inset-x-0 bottom-0 bg-black/55 py-1 text-[0.45rem] tracking-[0.2em] text-white">{scene.title}</span>
            </button>
          ))}
        </div>
      </div>

      <style jsx>{`
        @media (max-width: 639px) {
          section { --video-position-desktop: ${VIDEO_POSITION_MOBILE}; }
        }
      `}</style>
    </section>
  );
}
