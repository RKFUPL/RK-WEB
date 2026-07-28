'use client';

import { AnimatePresence, motion } from 'framer-motion';
import {
  ChevronDown,
  Heart,
  Menu,
  Search,
  ShoppingBag,
  UserRound,
  X,
} from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { homeNavigation } from '@/lib/home-content';

const utilityLinks = ['Search', 'Wishlist', 'Account', 'Shopping Bag'] as const;

export function StickyHeader() {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const headerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    document.body.style.overflow = menuOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [menuOpen]);

  useLayoutEffect(() => {
    const header = headerRef.current;
    if (!header) {
      return;
    }

    const updateHeight = () => {
      document.documentElement.style.setProperty(
        '--rk-header-height',
        `${Math.round(header.getBoundingClientRect().height)}px`
      );
    };

    updateHeight();

    const observer = new ResizeObserver(updateHeight);
    observer.observe(header);
    window.addEventListener('resize', updateHeight);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateHeight);
    };
  }, []);

  return (
    <header
      ref={headerRef}
      className={cn(
        'fixed inset-x-0 top-0 z-[200] border-b border-black/6 text-charcoal transition-all duration-500',
        scrolled ? 'bg-transparent shadow-none' : 'bg-white shadow-[0_1px_0_rgba(0,0,0,0.04)]'
      )}
    >
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4 lg:px-10">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            className="inline-flex items-center gap-2 lg:hidden"
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
            <span className="text-[0.65rem] uppercase tracking-[0.35em]">Menu</span>
          </button>
          <a href="#home" className="flex items-center">
            <img
              src="/RK_LOGOMARK.svg" 
              alt="RK Logo" 
              width="80"
              height="40"
              className="h-10 w-auto"
              style={{ width: 'auto', height: '2.5rem' }}
            />
          </a>
        </div>

        <nav className="hidden items-center gap-7 text-[0.7rem] uppercase tracking-[0.28em] text-charcoal/72 lg:flex">
          {homeNavigation.map((item) => (
            <a
              key={item}
              href={`#${item.toLowerCase().replace(/\s+/g, '-')}`}
              className="transition hover:text-charcoal"
            >
              <span className="inline-flex items-center gap-1">
                {item}
                {item === 'Collections' ? <ChevronDown className="h-3 w-3" /> : null}
              </span>
            </a>
          ))}
        </nav>

        <div className="hidden items-center gap-5 lg:flex">
          <button className="transition hover:text-gold" aria-label="Search">
            <Search className="h-4 w-4" />
          </button>
          <button className="transition hover:text-gold" aria-label="Wishlist">
            <Heart className="h-4 w-4" />
          </button>
          <button className="transition hover:text-gold" aria-label="Account">
            <UserRound className="h-4 w-4" />
          </button>
          <button className="transition hover:text-gold" aria-label="Shopping Bag">
            <ShoppingBag className="h-4 w-4" />
          </button>
        </div>
      </div>

      <AnimatePresence>
        {menuOpen ? (
          <motion.div
            className="fixed inset-0 z-50 bg-ink/20"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setMenuOpen(false)}
          >
            <motion.aside
              className="absolute right-0 top-0 h-full w-[88vw] max-w-sm border-l border-black/6 bg-ivory px-6 py-6 shadow-2xl"
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-center justify-between">
                <img
                  src="/RK_LOGOMARK.svg" 
                  alt="RK Logo" 
                  width="80"
                  height="40"
                  className="h-10 w-auto"
                  style={{ width: 'auto', height: '2.5rem' }}
                />
                <button onClick={() => setMenuOpen(false)} aria-label="Close menu">
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="mt-8 space-y-5">
                {homeNavigation.map((item) => (
                  <a
                    key={item}
                    href={`#${item.toLowerCase().replace(/\s+/g, '-')}`}
                    onClick={() => setMenuOpen(false)}
                    className="flex items-center justify-between border-b border-black/6 pb-4 text-lg tracking-[0.08em]"
                  >
                    <span>{item}</span>
                    <ChevronDown className="h-4 w-4 -rotate-90" />
                  </a>
                ))}
              </div>
              <div className="mt-8 grid grid-cols-2 gap-3 text-xs uppercase tracking-[0.3em] text-charcoal/60">
                {utilityLinks.map((item) => (
                  <button
                    key={item}
                    className="border border-black/8 bg-white px-4 py-4 text-left transition hover:border-gold hover:text-gold"
                  >
                    {item}
                  </button>
                ))}
              </div>
            </motion.aside>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </header>
  );
}
