'use client';

import { Pause, Play, Volume2, VolumeX } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { runwayHeroVideoUrl } from '@/lib/home-content';

type RunwayHeroProps = {
  title: string;
};

export function RunwayHero({ title }: RunwayHeroProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const indicatorTimerRef = useRef<number | null>(null);
  const [muted, setMuted] = useState(true);
  const [paused, setPaused] = useState(false);
  const [indicator, setIndicator] = useState<'play' | 'pause' | null>(null);

  useEffect(() => () => {
    if (indicatorTimerRef.current) window.clearTimeout(indicatorTimerRef.current);
  }, []);

  const showIndicator = (nextIndicator: 'play' | 'pause') => {
    setIndicator(nextIndicator);
    if (indicatorTimerRef.current) window.clearTimeout(indicatorTimerRef.current);
    indicatorTimerRef.current = window.setTimeout(() => setIndicator(null), 850);
  };

  const togglePlayback = () => {
    const video = videoRef.current;
    if (!video) return;

    if (video.paused) {
      void video.play().then(() => showIndicator('play')).catch(() => undefined);
    } else {
      video.pause();
      showIndicator('pause');
    }
  };

  const toggleMute = () => {
    const video = videoRef.current;
    if (!video) return;
    const nextMuted = !video.muted;
    video.muted = nextMuted;
    setMuted(nextMuted);
  };

  return (
    <section id="runway-hero" aria-label={`${title} runway film`} onClick={togglePlayback} className="relative isolate flex min-h-[100svh] cursor-pointer items-end overflow-hidden bg-black text-white">
      <video
        ref={videoRef}
        src={runwayHeroVideoUrl}
        autoPlay
        loop
        muted={muted}
        playsInline
        preload="metadata"
        controls={false}
        onPlay={() => setPaused(false)}
        onPause={() => setPaused(true)}
        onCanPlay={(event) => void event.currentTarget.play().catch(() => undefined)}
        className="pointer-events-none absolute inset-0 h-full w-full object-cover object-center"
        aria-label="Espiritu Libre at LFW runway film"
      />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/20 via-transparent to-black/65" />

      <div className="pointer-events-none relative z-10 w-full px-6 pb-10 pt-40 sm:pb-14 lg:px-12 lg:pb-20">
        <div className="flex items-end justify-between gap-8">
          <div>
            <p className="text-[0.58rem] uppercase tracking-[0.48em] text-gold">Runway collection</p>
            <h1 className="mt-5 max-w-3xl font-display text-[clamp(3.2rem,8vw,8rem)] leading-[0.82] tracking-[-0.03em] text-white">{title}</h1>
          </div>

          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              toggleMute();
            }}
            aria-label={muted ? 'Unmute runway film' : 'Mute runway film'}
            aria-pressed={!muted}
            className="pointer-events-auto flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/60 bg-black/25 text-white backdrop-blur-sm transition hover:border-gold hover:bg-gold hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </button>
        </div>
      </div>

      <div aria-live="polite" className={`pointer-events-none absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2 transition duration-300 ${indicator ? 'scale-100 opacity-100' : 'scale-90 opacity-0'}`}>
        <span className="grid h-14 w-14 place-items-center rounded-full border border-white/60 bg-black/25 text-white backdrop-blur-sm">
          {indicator === 'pause' ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
        </span>
      </div>
    </section>
  );
}
