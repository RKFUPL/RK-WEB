'use client';

import Link from 'next/link';
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
import { brandLogoUrl } from '@/lib/home-content';
import { cn } from '@/lib/utils';

const mainLinks = [
  { label: 'Home', href: '#home' },
  { label: 'Lookbook', href: '/rk-lookbooks' },
  { label: 'About', href: '#about' },
  { label: 'Contact', href: '#footer' },
] as const;

const collectionLinks = [
  { label: 'Aakaar', href: '/collections/aakaar-insights' },
  { label: 'Anamika', href: '/collections' },
  { label: 'Hasthkala', href: '/collections' },
  { label: 'Inaara', href: '/collections' },
  { label: 'Naqab', href: '/collections' },
  { label: 'Sandook', href: '/collections' },
] as const;

const utilityLinks = ['Search', 'Wishlist', 'Account', 'Shopping Bag'] as const;

export function StickyHeader() {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [collectionsOpen, setCollectionsOpen] = useState(false);
  const [collectionsPinned, setCollectionsPinned] = useState(false);
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

  const openCollections = () => setCollectionsOpen(true);
  const closeCollections = () => {
    if (!collectionsPinned) {
      setCollectionsOpen(false);
    }
  };
  const toggleCollections = () => {
    setCollectionsPinned((current) => {
      const next = !current;
      setCollectionsOpen(next);
      return next;
    });
  };

  const handleNavigation = () => {
    setMenuOpen(false);
    setCollectionsOpen(false);
    setCollectionsPinned(false);
  };

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
          <Link href="#home" className="flex items-center">
            <img
              src={brandLogoUrl}
              alt="RK Logo"
              width="80"
              height="40"
              className="h-10 w-auto"
              style={{ width: 'auto', height: '2.5rem' }}
            />
          </Link>
        </div>

        <nav className="hidden items-center gap-7 text-[0.7rem] uppercase tracking-[0.28em] text-charcoal/72 lg:flex">
          <div
            className="relative"
            onMouseEnter={openCollections}
            onMouseLeave={closeCollections}
          >
            <button
              type="button"
              onClick={toggleCollections}
              className="inline-flex items-center gap-1 transition hover:text-charcoal"
              aria-expanded={collectionsOpen}
            >
              Collections
              <ChevronDown className="h-3 w-3" />
            </button>

            <AnimatePresence>
              {collectionsOpen ? (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 8 }}
                  transition={{ duration: 0.24, ease: 'easeOut' }}
                  className="absolute left-1/2 top-full z-50 mt-4 w-[22rem] -translate-x-1/2 border border-black/8 bg-white p-5 shadow-[0_18px_45px_rgba(18,18,18,0.08)]"
                >
                  <p className="text-[0.62rem] uppercase tracking-[0.34em] text-charcoal/40">
                    Collections
                  </p>
                  <div className="mt-4 grid gap-3">
                    {collectionLinks.map((collection) => (
                      <Link
                        key={collection.label}
                        href={collection.href}
                        onClick={handleNavigation}
                        className="flex items-center justify-between border-b border-black/6 pb-3 text-sm uppercase tracking-[0.22em] transition hover:text-gold"
                      >
                        <span>{collection.label}</span>
                        <ChevronDown className="h-4 w-4 -rotate-90" />
                      </Link>
                    ))}
                  </div>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>

          {mainLinks.map((item) =>
            item.href.startsWith('#') ? (
              <a
                key={item.label}
                href={item.href}
                onClick={handleNavigation}
                className="transition hover:text-charcoal"
              >
                {item.label}
              </a>
            ) : (
              <Link
                key={item.label}
                href={item.href}
                onClick={handleNavigation}
                className="transition hover:text-charcoal"
              >
                {item.label}
              </Link>
            )
          )}
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
                  src={brandLogoUrl}
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
                <button
                  type="button"
                  onClick={() => setCollectionsOpen((current) => !current)}
                  className="flex w-full items-center justify-between border-b border-black/6 pb-4 text-lg tracking-[0.08em]"
                >
                  <span>Collections</span>
                  <ChevronDown className={cn('h-4 w-4 transition', collectionsOpen ? 'rotate-180' : '-rotate-90')} />
                </button>
                <AnimatePresence>
                  {collectionsOpen ? (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="space-y-3 pl-4 pt-2">
                        {collectionLinks.map((collection) => (
                          <Link
                            key={collection.label}
                            href={collection.href}
                            onClick={handleNavigation}
                            className="flex items-center justify-between border-b border-black/6 pb-3 text-sm uppercase tracking-[0.22em]"
                          >
                            <span>{collection.label}</span>
                            <ChevronDown className="h-4 w-4 -rotate-90" />
                          </Link>
                        ))}
                      </div>
                    </motion.div>
                  ) : null}
                </AnimatePresence>

                {mainLinks.map((item) =>
                  item.href.startsWith('#') ? (
                    <a
                      key={item.label}
                      href={item.href}
                      onClick={handleNavigation}
                      className="flex items-center justify-between border-b border-black/6 pb-4 text-lg tracking-[0.08em]"
                    >
                      <span>{item.label}</span>
                      <ChevronDown className="h-4 w-4 -rotate-90" />
                    </a>
                  ) : (
                    <Link
                      key={item.label}
                      href={item.href}
                      onClick={handleNavigation}
                      className="flex items-center justify-between border-b border-black/6 pb-4 text-lg tracking-[0.08em]"
                    >
                      <span>{item.label}</span>
                      <ChevronDown className="h-4 w-4 -rotate-90" />
                    </Link>
                  )
                )}
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
