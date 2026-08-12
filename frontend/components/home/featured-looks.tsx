'use client';

import { Volume2, VolumeX } from 'lucide-react';
import { useRef, useState } from 'react';

const VIDEO_SRC = 'https://video.wixstatic.com/video/afed36_2e5b8660523d4d1eaaac8173ecd89d8f/720p/mp4/file.mp4';

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
        src={VIDEO_SRC}
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
