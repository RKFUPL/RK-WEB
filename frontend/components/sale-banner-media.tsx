'use client';

import { useEffect, useState } from 'react';
import { apiBaseUrl } from '@/lib/rbac';

export type SaleBannerMediaProps = {
  url?: string;
  type?: 'image' | 'video';
  posterUrl?: string | null;
  alt: string;
  className?: string;
  imageClassName?: string;
  videoClassName?: string;
  controls?: boolean;
  testId?: string;
};

function mediaSource(url: string) {
  return /^https:\/\//i.test(url) ? url : `${apiBaseUrl}${url}`;
}

export function SaleBannerMedia({url, type = 'image', posterUrl, alt, className, imageClassName = 'block h-auto w-full object-contain object-center', videoClassName = 'block h-auto w-full object-contain object-center', controls = false, testId}: SaleBannerMediaProps) {
  const [reducedMotion, setReducedMotion] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(query.matches);
    update(); query.addEventListener?.('change', update);
    return () => query.removeEventListener?.('change', update);
  }, []);
  if (!url || type !== 'video' || failed || (reducedMotion && posterUrl)) {
    if (posterUrl && (type === 'video')) return <img data-testid={testId} src={mediaSource(posterUrl)} alt={alt} className={imageClassName} />;
    if (type === 'image' && url) return <img data-testid={testId} src={mediaSource(url)} alt={alt} className={imageClassName} />;
    return <div data-testid={testId} role="img" aria-label={`${alt} media unavailable`} className={`flex min-h-48 items-center justify-center bg-sand/60 text-sm text-charcoal/65 ${className || ''}`}>Campaign banner is unavailable.</div>;
  }
  return <video data-testid={testId} aria-label={alt} className={videoClassName} autoPlay={!reducedMotion && !controls} muted loop={!reducedMotion && !controls} playsInline preload="metadata" controls={controls || reducedMotion} poster={posterUrl ? mediaSource(posterUrl) : undefined} onError={() => setFailed(true)}>
    <source src={mediaSource(url)} />
    Your browser cannot play this campaign video.
  </video>;
}
