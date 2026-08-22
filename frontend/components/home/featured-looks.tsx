'use client';

import Link from 'next/link';
import { ArrowRight, Volume2, VolumeX } from 'lucide-react';
import { useRef, useState } from 'react';
import { homepageHeroVideoUrl } from '@/lib/home-content';

export function FeaturedLooks() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [muted, setMuted] = useState(true);

  const toggleMute = () => {
    const video = videoRef.current;
    if (!video) return;
    const nextMuted = !video.muted;
    video.muted = nextMuted;
    setMuted(nextMuted);
  };

  return (
    <section id="lookbook" aria-label="Rashi Kapoor fashion film" className="relative isolate h-[100svh] min-h-[38rem] overflow-hidden bg-black">
      <video
        ref={videoRef}
        src={homepageHeroVideoUrl}
        autoPlay
        loop
        muted={muted}
        playsInline
        preload="metadata"
        controls={false}
        onContextMenu={(event) => event.preventDefault()}
        onCanPlay={(event) => void event.currentTarget.play().catch(() => undefined)}
        className="absolute inset-0 h-full w-full object-cover object-center"
        aria-label="Rashi Kapoor fashion film"
      />
      <div className="pointer-events-none absolute inset-0 z-10 flex items-end bg-gradient-to-t from-black/80 via-black/15 to-transparent px-6 pb-10 lg:px-12 lg:pb-16">
        <div className="pointer-events-auto">
          <h2 className="font-display text-[clamp(3rem,7vw,7rem)] leading-[0.84] tracking-[-0.035em] text-white">The Runway Collection</h2>
          <Link href="/runway" className="mt-6 inline-flex items-center gap-3 text-[0.62rem] uppercase tracking-[0.3em] text-white transition hover:text-gold">
            View runway <ArrowRight className="h-4 w-4 transition-transform duration-300 hover:translate-x-1" />
          </Link>
        </div>
      </div>
      <button
        type="button"
        onClick={toggleMute}
        aria-label={muted ? 'Unmute fashion film' : 'Mute fashion film'}
        title={muted ? 'Unmute' : 'Mute'}
        className="absolute bottom-6 right-6 z-20 flex h-11 w-11 items-center justify-center rounded-full border border-white/60 bg-black/30 text-white backdrop-blur-sm transition hover:border-gold hover:bg-gold hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white lg:bottom-10 lg:right-10"
      >
        {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
      </button>
    </section>
  );
}
