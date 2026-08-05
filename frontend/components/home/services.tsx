'use client';

import { ArrowLeft, ArrowRight } from 'lucide-react';
import { motion } from 'framer-motion';
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { testimonials } from '@/lib/home-content';

const testimonialDetails = [
  { location: 'Mumbai', occasion: 'Private fitting' },
  { location: 'New Delhi', occasion: 'Festive edit' },
  { location: 'Kolkata', occasion: 'Occasion dressing' },
  { location: 'Bengaluru', occasion: 'The evening edit' },
];

export function Services() {
  const [start, setStart] = useState<number>(testimonials.length);
  const [visibleCount, setVisibleCount] = useState(3);
  const [paused, setPaused] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const shelfRef = useRef<HTMLDivElement | null>(null);
  const dragStart = useRef({ x: 0, scrollLeft: 0 });
  const dragged = useRef(false);
  const scrollAnimation = useRef<number | null>(null);
  const skipNextScrollAnimation = useRef(true);
  const inactivityTimer = useRef<number | null>(null);
  const startRef = useRef(start);

  useEffect(() => {
    startRef.current = start;
  }, [start]);

  useEffect(() => {
    return () => {
      if (inactivityTimer.current) window.clearTimeout(inactivityTimer.current);
    };
  }, []);

  const registerInteraction = () => {
    setPaused(true);
    if (inactivityTimer.current) window.clearTimeout(inactivityTimer.current);
    inactivityTimer.current = window.setTimeout(() => {
      const shelf = shelfRef.current;
      const target = nearestTargetFor(startRef.current);
      if (shelf && target) scrollShelfTo(target.offsetLeft);
      setPaused(false);
    }, 10000);
  };

  useEffect(() => {
    const updateVisibleCount = () => setVisibleCount(window.innerWidth < 768 ? 1 : window.innerWidth < 1280 ? 2 : 3);
    updateVisibleCount();
    window.addEventListener('resize', updateVisibleCount);
    return () => window.removeEventListener('resize', updateVisibleCount);
  }, []);

  const middleStart = testimonials.length;
  const maxStart = middleStart + testimonials.length - 1;
  const carouselTestimonials = [...testimonials, ...testimonials, ...testimonials];

  const scrollShelfTo = (left: number) => {
    const shelf = shelfRef.current;
    if (!shelf) return;
    if (scrollAnimation.current) window.cancelAnimationFrame(scrollAnimation.current);
    const from = shelf.scrollLeft;
    const distance = left - from;
    const startedAt = performance.now();
    const duration = 260;
    const animate = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      shelf.scrollLeft = from + distance * eased;
      if (progress < 1) scrollAnimation.current = window.requestAnimationFrame(animate);
    };
    scrollAnimation.current = window.requestAnimationFrame(animate);
  };

  const nearestTargetFor = (index: number) => {
    const shelf = shelfRef.current;
    if (!shelf) return undefined;
    const candidates = [index, index + testimonials.length, index + testimonials.length * 2]
      .map((candidate) => shelf.children[candidate] as HTMLElement | undefined)
      .filter((candidate): candidate is HTMLElement => Boolean(candidate));
    return candidates.reduce((nearest, candidate) => (
      Math.abs(candidate.offsetLeft - shelf.scrollLeft) < Math.abs(nearest.offsetLeft - shelf.scrollLeft) ? candidate : nearest
    ), candidates[0]);
  };

  useEffect(() => {
    const shelf = shelfRef.current;
    const target = nearestTargetFor(start);
    if (!shelf || !target) return;
    if (skipNextScrollAnimation.current) {
      shelf.scrollLeft = target.offsetLeft;
      skipNextScrollAnimation.current = false;
      return;
    }
    scrollShelfTo(target.offsetLeft);
  }, [start, visibleCount]);

  useEffect(() => {
    if (start !== middleStart - 1 && start !== maxStart + 1) return;
    const timer = window.setTimeout(() => {
      skipNextScrollAnimation.current = true;
      setStart(start === middleStart - 1 ? maxStart : middleStart);
    }, 280);
    return () => window.clearTimeout(timer);
  }, [middleStart, maxStart, start]);

  useEffect(() => {
    const shelf = shelfRef.current;
    if (!shelf) return;
    const handleWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaX) <= Math.abs(event.deltaY) || event.deltaX === 0) return;
      event.preventDefault();
      registerInteraction();
      shelf.scrollLeft += event.deltaX;
    };
    shelf.addEventListener('wheel', handleWheel, { passive: false });
    return () => shelf.removeEventListener('wheel', handleWheel);
  }, []);

  useEffect(() => {
    if (paused) return;
    const timer = window.setInterval(() => {
      setStart((current) => current + 1);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [maxStart, paused]);

  const move = (direction: -1 | 1) => {
    registerInteraction();
    setStart((current) => {
      if (direction < 0) return current - 1;
      return current + 1;
    });
  };

  const startDrag = (event: PointerEvent<HTMLDivElement>) => {
    const shelf = shelfRef.current;
    if (!shelf || event.button !== 0) return;
    registerInteraction();
    dragStart.current = { x: event.clientX, scrollLeft: shelf.scrollLeft };
    dragged.current = false;
    setIsDragging(true);
    shelf.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const moveDrag = (event: PointerEvent<HTMLDivElement>) => {
    const shelf = shelfRef.current;
    if (!shelf || !shelf.hasPointerCapture(event.pointerId)) return;
    const distance = event.clientX - dragStart.current.x;
    if (Math.abs(distance) > 5) dragged.current = true;
    if (dragged.current) event.preventDefault();
    shelf.scrollLeft = dragStart.current.scrollLeft - distance;
  };

  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    const shelf = shelfRef.current;
    if (shelf?.hasPointerCapture(event.pointerId)) shelf.releasePointerCapture(event.pointerId);
    setIsDragging(false);
  };

  const handleShelfScroll = () => {
    const shelf = shelfRef.current;
    const firstCopy = shelf?.children[testimonials.length] as HTMLElement | undefined;
    const firstCard = shelf?.children[0] as HTMLElement | undefined;
    if (!shelf || !firstCopy || !firstCard) return;
    const copyWidth = firstCopy.offsetLeft - firstCard.offsetLeft;
    if (!copyWidth) return;
    if (shelf.scrollLeft < copyWidth * 0.5) shelf.scrollLeft += copyWidth;
    if (shelf.scrollLeft > copyWidth * 1.5) shelf.scrollLeft -= copyWidth;
  };

  return (
    <section id="services" className="testimonial-editorial-section bg-ivory">
      <div className="mx-auto w-full max-w-7xl px-6 py-20 lg:px-10 lg:py-28">
      <div className="max-w-3xl space-y-5">
        <p className="text-xs uppercase tracking-[0.38em] text-charcoal/50">The house speaks</p>
        <h2 className="font-display text-5xl leading-[0.9] text-charcoal md:text-7xl">
          Words from the women who wear our collection.
        </h2>
      </div>

      <div
        className="testimonial-carousel relative mt-14 px-8 md:px-12"
      >
        <button type="button" onClick={() => move(-1)} aria-label="Previous testimonial" className="absolute left-0 top-1/2 z-20 -translate-y-1/2 text-[#2a2622]/60 transition-colors duration-150 hover:text-gold dark:text-[#f5f2ee]/70">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <button type="button" onClick={() => move(1)} aria-label="Next testimonial" className="absolute right-0 top-1/2 z-20 -translate-y-1/2 text-[#2a2622]/60 transition-colors duration-150 hover:text-gold dark:text-[#f5f2ee]/70">
          <ArrowRight className="h-5 w-5" />
        </button>
        <div
          ref={shelfRef}
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onScroll={handleShelfScroll}
          className={`testimonial-shelf flex gap-6 overflow-x-auto overscroll-x-contain pb-2 touch-pan-x select-none md:gap-8 ${isDragging ? 'is-dragging' : ''}`}
        >
          {carouselTestimonials.map((testimonial, index) => {
            const details = testimonialDetails[index % testimonialDetails.length];
            return (
              <motion.article
                key={`${testimonial.name}-${index}`}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.12 }}
                transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                className={`group relative min-w-0 shrink-0 basis-full pt-4 text-left before:absolute before:left-0 before:right-0 before:top-0 before:h-px before:origin-left before:scale-x-0 before:bg-gold before:transition-transform before:duration-150 before:ease-out group-hover:before:scale-x-100 md:basis-[calc((100%-2rem)/2)] xl:basis-[calc((100%-4rem)/3)] ${start === index ? 'before:scale-x-100' : ''}`}
              >
                <div className="flex aspect-[3/4] items-center justify-center overflow-hidden bg-black text-center text-[0.62rem] uppercase tracking-[0.3em] text-white/80 transition-colors duration-300 group-hover:text-gold">
                  Photo not found
                </div>
                <div className="border-l border-black/10 py-6 pl-5 dark:border-white/15 md:pl-7">
                  <p className="font-display text-5xl leading-none text-gold">“</p>
                  <p className="testimonial-copy mt-1 max-w-sm font-display text-2xl leading-[1.02] transition-colors duration-300 md:text-3xl">
                    “{testimonial.quote}”
                  </p>
                  <p className="testimonial-name mt-7 text-[0.65rem] uppercase tracking-[0.3em]">
                    {testimonial.name}
                  </p>
                  <p className="testimonial-meta mt-2 text-xs uppercase tracking-[0.24em]">
                    {details.location} · {details.occasion}
                  </p>
                </div>
              </motion.article>
            );
          })}
        </div>
      </div>
      </div>
    </section>
  );
}
