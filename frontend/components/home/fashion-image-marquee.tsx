'use client';

import Image from 'next/image';
import { createPortal } from 'react-dom';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { useEffect, useRef, useState } from 'react';

const CLOUDINARY_STRIP_TRANSFORM =
  'https://res.cloudinary.com/fm1bwbrd/image/upload/f_auto,q_auto,c_fill,g_auto,w_360,h_480';
const CLOUDINARY_PREVIEW_TRANSFORM =
  'https://res.cloudinary.com/fm1bwbrd/image/upload/f_auto,q_auto,c_fill,g_auto,w_720,h_960';

const DEFAULT_ASSETS = [
  'v1786697080/_1S34315_compressed_wrwdsv.jpg',
  'v1786697079/_1S34233_compressed_ukmkk9.jpg',
  'v1786697076/_1S34348_compressed_x8pbfd.jpg',
  'v1786697076/_1S33878_compressed_bzddji.jpg',
  'v1786697074/_1S34056_compressed_isq67c.jpg',
  'v1786697071/_1S34382_compressed_vdtc1s.jpg',
  'v1786697065/_1S34153_compressed_efsfsm.jpg',
  'v1786697059/_1S34121_compressed_camhrb.jpg',
  'v1786697056/_1S34337_compressed_ajwtau.jpg',
  'v1786697056/_1S34008_compressed_jpb4ok.jpg',
  'v1786697052/_1S34202_compressed_egdklq.jpg',
  'v1786697048/_1S34351_compressed_x4p64m.jpg',
  'v1786697046/_1S33962_compressed_x9grdb.jpg',
  'v1786697044/_1S34197_compressed_ovaixs.jpg',
  'v1786697040/_1S34088_compressed_ljrpub.jpg',
  'v1786697039/_1S34516_compressed_xskfsm.jpg',
  'v1786697036/_1S34061_compressed_mjlrlj.jpg',
  'v1786697031/_1S34277_compressed_i8fgwg.jpg',
  'v1786697025/_1S33906_compressed_ij5ynl.jpg',
  'v1786697025/_1S33931_compressed_f3ysuh.jpg',
  'v1786697024/_1S34221_compressed_wvzmtz.jpg',
  'v1786697021/_1S34131_compressed_lliyze.jpg',
  'v1786697021/_1S33855_compressed_lr3gwx.jpg',
  'v1786697016/_1S33890_compressed_i4uclw.jpg',
  'v1786697015/_1S34432_compressed_ulz3dr.jpg',
  'v1786697014/_1S34028_compressed_wnytlc.jpg',
  'v1786697011/_1S33991_compressed_clmiux.jpg',
  'v1786697007/_1S34293_compressed_d3sujt.jpg',
  'v1786697007/_1S34263_compressed_fhj2wo.jpg',
  'v1786696587/_1S34103_kh8qqa.jpg',
  'v1786696587/_1S33978_qiktw7.jpg',
  'v1786696579/_1S33936_orsreo.jpg',
  'v1786696577/_1S33913_npnisp.jpg',
  'v1786696574/_1S34025_ntjt53.jpg',
] as const;

export type FashionImage = {
  src: string;
  previewSrc: string;
};

export const fashionFilmImages: readonly FashionImage[] = DEFAULT_ASSETS.map((asset) => ({
  src: `${CLOUDINARY_STRIP_TRANSFORM}/${asset}`,
  previewSrc: `${CLOUDINARY_PREVIEW_TRANSFORM}/${asset}`,
}));

type FashionImageMarqueeProps = {
  images?: readonly FashionImage[];
};

type PreviewState = FashionImage & {
  left: number;
  top: number;
  label: string;
};

const getPreviewPosition = (element: HTMLElement) => {
  if (typeof window === 'undefined') return { left: 0, top: 0 };

  const isMobile = window.innerWidth < 768;
  const previewWidth = isMobile
    ? Math.min(280, Math.max(220, window.innerWidth * 0.72))
    : Math.min(280, Math.max(220, window.innerWidth * 0.18));
  const previewHeight = previewWidth * (4 / 3);
  const viewportGutter = 16;
  const cardRect = element.getBoundingClientRect();
  const maxLeft = Math.max(viewportGutter, window.innerWidth - previewWidth - viewportGutter);
  const left = Math.min(
    Math.max(viewportGutter, cardRect.left + cardRect.width / 2 - previewWidth / 2),
    maxLeft,
  );
  const maxTop = Math.max(viewportGutter, window.innerHeight - previewHeight - viewportGutter);
  const preferredTop = cardRect.top - previewHeight - 18;
  const top =
    preferredTop >= viewportGutter
      ? preferredTop
      : Math.min(Math.max(viewportGutter, cardRect.bottom + 18), maxTop);

  return { left, top };
};

export function FashionImageMarquee({ images = fashionFilmImages }: FashionImageMarqueeProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [activePreview, setActivePreview] = useState<PreviewState | null>(null);
  const [previewVisible, setPreviewVisible] = useState(false);
  // One complete repeated strip should take roughly 30–40 seconds at desktop
  // widths, keeping the editorial movement visible without making it feel
  // hurried. The CSS animation is paused while a preview is open or focused.
  const duration = Math.min(40, Math.max(30, images.length * 1.1));
  const marqueeStyle = {
    '--fashion-marquee-duration': `${duration}s`,
  } as CSSProperties;

  const setPlaybackRate = (rate: number) => {
    trackRef.current?.getAnimations().forEach((animation) => {
      animation.updatePlaybackRate(rate);
    });
  };

  const hidePreview = (resume = false) => {
    setPreviewVisible(false);
    if (resume) setPlaybackRate(1);
  };

  const showPreview = (image: FashionImage, element: HTMLElement, index: number) => {
    const position = getPreviewPosition(element);
    setActivePreview({
      ...image,
      ...position,
      label: `Rashi Kapoor fashion photograph ${index + 1}`,
    });
    setPreviewVisible(true);
    setPlaybackRate(0);
  };

  useEffect(() => {
    if (!activePreview) return undefined;

    const handleOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('[data-fashion-marquee-card]') || target.closest('[data-fashion-image-preview]')) return;
      hidePreview(true);
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') hidePreview(true);
    };

    document.addEventListener('pointerdown', handleOutsidePointer);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('pointerdown', handleOutsidePointer);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [activePreview]);

  useEffect(() => {
    if (previewVisible || !activePreview) return undefined;

    const timeout = window.setTimeout(() => setActivePreview(null), 320);
    return () => window.clearTimeout(timeout);
  }, [activePreview, previewVisible]);

  if (images.length === 0) return null;

  const handleStripPointerEnter = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'touch') setPlaybackRate(0);
  };

  const handleStripPointerLeave = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'touch') hidePreview(true);
  };

  return (
    <div
      className="fashion-image-marquee"
      role="group"
      aria-label="Rashi Kapoor fashion photographs"
      style={marqueeStyle}
      onPointerEnter={handleStripPointerEnter}
      onPointerLeave={handleStripPointerLeave}
    >
      <div className="fashion-image-marquee-viewport">
        <div ref={trackRef} className="fashion-image-marquee-track">
          {[0, 1].map((sequence) => (
            <div
              key={sequence}
              className={`fashion-image-marquee-sequence${sequence === 1 ? ' fashion-image-marquee-sequence--duplicate' : ''}`}
              aria-hidden={sequence === 1}
            >
              {images.map((image, index) => {
                const label = `Preview fashion photograph ${index + 1}`;
                const handleFocus = (event: React.FocusEvent<HTMLButtonElement>) => {
                  showPreview(image, event.currentTarget, index);
                };
                const handleBlur = (event: React.FocusEvent<HTMLButtonElement>) => {
                  const relatedTarget = event.relatedTarget;
                  if (!(relatedTarget instanceof Element && relatedTarget.closest('[data-fashion-marquee-card]'))) {
                    hidePreview(true);
                  }
                };

                return (
                  <button
                    key={`${sequence}-${image.src}`}
                    type="button"
                    className="fashion-image-marquee-card"
                    data-fashion-marquee-card
                    aria-label={label}
                    tabIndex={sequence === 0 ? 0 : -1}
                    onMouseEnter={(event) => showPreview(image, event.currentTarget, index)}
                    onPointerLeave={(event) => {
                      if (event.pointerType !== 'touch') setPreviewVisible(false);
                    }}
                    onFocus={handleFocus}
                    onBlur={handleBlur}
                    onClick={(event) => showPreview(image, event.currentTarget, index)}
                  >
                    <Image
                      src={image.src}
                      alt={sequence === 0 ? `Rashi Kapoor fashion look ${index + 1}` : ''}
                      width={360}
                      height={480}
                      sizes="(max-width: 767px) 28vw, 172px"
                      loading={sequence === 0 && index < 12 ? 'eager' : 'lazy'}
                      draggable={false}
                      className="h-full w-full object-cover"
                    />
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {activePreview && typeof document !== 'undefined'
        ? createPortal(
            <div
              className={`fashion-image-preview${previewVisible ? ' is-visible' : ''}`}
              data-fashion-image-preview
              role="dialog"
              aria-label="Fashion photograph preview"
              style={{ left: activePreview.left, top: activePreview.top }}
            >
              <Image
                src={activePreview.previewSrc}
                alt={activePreview.label}
                width={720}
                height={960}
                sizes="(max-width: 767px) 72vw, 280px"
                priority
                className="h-full w-full object-cover"
              />
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
