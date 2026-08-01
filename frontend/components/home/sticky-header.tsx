'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
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
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { brandLogoUrl, collectionPages, searchItems } from '@/lib/home-content';
import { cn } from '@/lib/utils';

const mainLinks = [{ label: 'Lookbook', href: '/rk-lookbooks' }] as const;

const collectionLinks = collectionPages;

const utilityLinks = [
  { label: 'Search', Icon: Search },
  { label: 'Wishlist', Icon: Heart },
  { label: 'Account', Icon: UserRound },
  { label: 'Shopping Bag', Icon: ShoppingBag },
] as const;
const navItemClass =
  'border-0 bg-transparent p-0 font-body text-[0.7rem] uppercase tracking-[0.28em] text-current transition hover:opacity-70';

type StickyHeaderProps = {
  transparentAtTop?: boolean;
};

export function StickyHeader({ transparentAtTop = false }: StickyHeaderProps) {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [collectionsOpen, setCollectionsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const headerRef = useRef<HTMLElement | null>(null);
  const pathname = usePathname();
  const router = useRouter();
  const isTransparent = transparentAtTop && !scrolled && !searchOpen;

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
  const closeCollections = () => setCollectionsOpen(false);

  const handleNavigation = () => {
    setMenuOpen(false);
    setCollectionsOpen(false);
    setSearchOpen(false);
  };

  const searchResults = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    if (!normalizedQuery) {
      return searchItems;
    }

    return searchItems.filter((item) =>
      `${item.title} ${item.type} ${item.keywords}`.toLowerCase().includes(normalizedQuery)
    );
  }, [searchQuery]);

  const scrollToHome = () => {
    handleNavigation();

    if (pathname !== '/') {
      router.push('/');
      window.setTimeout(() => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }, 100);
      return;
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const scrollToAbout = () => {
    handleNavigation();

    const about = document.getElementById('about');
    if (about) {
      about.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }

    if (pathname !== '/') {
      router.push('/');
      window.setTimeout(() => {
        document.getElementById('about')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    }
  };

  const scrollToFooter = () => {
    handleNavigation();

    const footer = document.getElementById('footer');
    if (footer) {
      footer.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }

    if (pathname !== '/') {
      router.push('/');
      window.setTimeout(() => {
        document.getElementById('footer')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    }
  };

  return (
    <header
      ref={headerRef}
      className={cn(
        'fixed inset-x-0 top-0 z-[200] border-b transition-none',
        isTransparent
          ? 'border-transparent bg-transparent text-white shadow-none'
          : 'border-black/6 bg-white text-charcoal shadow-[0_1px_0_rgba(0,0,0,0.04)]',
        scrolled && !isTransparent ? 'shadow-[0_4px_18px_rgba(0,0,0,0.06)]' : ''
      )}
    >
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4 lg:px-10">
        <div className="flex w-full items-center justify-between gap-4 lg:w-auto">
          <Link href="/" className="flex items-center">
            <img
              src={brandLogoUrl}
              alt="RK Logo"
              width="80"
              height="40"
              className="h-10 w-auto"
              style={{ width: 'auto', height: '2.5rem', filter: isTransparent ? 'brightness(0) invert(1)' : undefined }}
            />
          </Link>
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            className="inline-flex items-center gap-2 lg:hidden"
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
            <span className="text-[0.65rem] uppercase tracking-[0.35em]">Menu</span>
          </button>
        </div>

        <nav className="hidden items-center gap-7 lg:flex">
          <button type="button" onClick={scrollToHome} className={navItemClass}>
            Home
          </button>

          <div className="relative" onMouseEnter={openCollections} onMouseLeave={closeCollections}>
            <Link
              href="/collections"
              onClick={handleNavigation}
              className={`${navItemClass} inline-flex items-center gap-1`}
              aria-expanded={collectionsOpen}
            >
              Collections
              <ChevronDown className="h-3 w-3" />
            </Link>

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
                        key={collection.name}
                        href={collection.route}
                        onClick={handleNavigation}
                        className="flex items-center justify-between border-b border-black/6 pb-3 text-sm uppercase tracking-[0.22em] transition hover:text-gold"
                      >
                        <span>{collection.name}</span>
                        <ChevronDown className="h-4 w-4 -rotate-90" />
                      </Link>
                    ))}
                  </div>
                </motion.div>
              ) : null}
              </AnimatePresence>
          </div>

          {mainLinks.map((item) => (
            <Link
              key={item.label}
              href={item.href}
              onClick={handleNavigation}
              className={navItemClass}
            >
              {item.label}
            </Link>
          ))}

          <button type="button" onClick={scrollToAbout} className={navItemClass}>
            About
          </button>

          <button
            type="button"
            onClick={scrollToFooter}
            className={navItemClass}
          >
            Contact
          </button>
        </nav>

        <div className="hidden items-center gap-5 lg:flex">
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="border-0 bg-transparent p-0 text-current transition hover:opacity-70"
            aria-label="Search"
          >
            <Search className="h-4 w-4" />
          </button>
          <button className="border-0 bg-transparent p-0 text-current transition hover:opacity-70" aria-label="Wishlist">
            <Heart className="h-4 w-4" />
          </button>
          <Link href="/account" className="border-0 bg-transparent p-0 text-current transition hover:opacity-70" aria-label="Account">
            <UserRound className="h-4 w-4" />
          </Link>
          <button className="border-0 bg-transparent p-0 text-current transition hover:opacity-70" aria-label="Shopping Bag">
            <ShoppingBag className="h-4 w-4" />
          </button>
        </div>
      </div>

      <AnimatePresence>
        {searchOpen ? (
          <motion.div
            className="fixed inset-0 z-[150] overflow-y-auto bg-white px-6 pb-12 pt-28 text-charcoal lg:px-10 lg:pt-32"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
            <div className="mx-auto max-w-7xl">
              <div className="flex items-center gap-3 border-b border-black/10 pb-5">
                <Search className="h-5 w-5 text-charcoal/55" />
                <input
                  autoFocus
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search collections, lookbooks, keywords..."
                  className="w-full bg-transparent text-base outline-none placeholder:text-charcoal/40"
                  aria-label="Search collections, lookbooks, and keywords"
                />
                <button type="button" onClick={() => setSearchOpen(false)} aria-label="Close search">
                  <X className="h-5 w-5 text-charcoal/60" />
                </button>
              </div>
              <div className="mt-10 grid gap-10 md:grid-cols-[18rem_1fr]">
                <aside className="hidden md:block">
                  <p className="border-b border-black/10 pb-4 text-xs uppercase tracking-[0.3em]">Suggestions</p>
                  <div className="space-y-5 pt-6 text-sm tracking-[0.08em] text-charcoal/80">
                    {['dresses', 'drape saree', 'embroidery', 'occasionwear', 'couture'].map((suggestion) => (
                      <button
                        key={suggestion}
                        type="button"
                        onClick={() => setSearchQuery(suggestion)}
                        className="block text-left transition hover:text-gold"
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                </aside>
                <section>
                  <div className="flex gap-8 border-b border-black/10 text-xs uppercase tracking-[0.3em] text-charcoal/45">
                    <span className="border-b border-charcoal pb-4 text-charcoal">Results</span>
                    <span className="pb-4">Collections</span>
                    <span className="pb-4">Pages</span>
                  </div>
                  <div className="divide-y divide-black/10 border-b border-black/10">
                    {searchResults.length ? searchResults.map((item) => (
                      <Link
                        key={`${item.type}-${item.href}`}
                        href={item.href}
                        onClick={handleNavigation}
                        className="flex items-center justify-between py-5 transition hover:text-gold"
                      >
                        <span className="text-base tracking-[0.08em]">{item.title}</span>
                        <span className="text-[0.62rem] uppercase tracking-[0.28em] text-charcoal/45">{item.type}</span>
                      </Link>
                    )) : <p className="py-5 text-sm text-charcoal/55">No matching collections or lookbooks found.</p>}
                  </div>
                </section>
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

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
                <div className="flex items-center justify-between border-b border-black/6 pb-4 text-lg tracking-[0.08em]">
                  <Link href="/collections" onClick={handleNavigation} className="flex-1">
                    Collections
                  </Link>
                  <button
                    type="button"
                    onClick={() => setCollectionsOpen((current) => !current)}
                    aria-label="Toggle collections"
                  >
                    <ChevronDown
                      className={cn(
                        'h-4 w-4 transition',
                        collectionsOpen ? 'rotate-180' : '-rotate-90'
                      )}
                    />
                  </button>
                </div>
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
                            key={collection.name}
                            href={collection.route}
                            onClick={handleNavigation}
                            className="flex items-center justify-between border-b border-black/6 pb-3 text-sm uppercase tracking-[0.22em]"
                          >
                            <span>{collection.name}</span>
                            <ChevronDown className="h-4 w-4 -rotate-90" />
                          </Link>
                        ))}
                      </div>
                    </motion.div>
                  ) : null}
                </AnimatePresence>

                <button
                  type="button"
                  onClick={scrollToHome}
                  className="flex items-center justify-between border-b border-black/6 pb-4 text-lg tracking-[0.08em]"
                >
                  <span>Home</span>
                  <ChevronDown className="h-4 w-4 -rotate-90" />
                </button>
                <Link
                  href="/collections"
                  onClick={handleNavigation}
                  className="flex items-center justify-between border-b border-black/6 pb-4 text-lg tracking-[0.08em]"
                >
                  <span>Collections</span>
                  <ChevronDown className="h-4 w-4 -rotate-90" />
                </Link>
                <Link
                  href="/rk-lookbooks"
                  onClick={handleNavigation}
                  className="flex items-center justify-between border-b border-black/6 pb-4 text-lg tracking-[0.08em]"
                >
                  <span>Lookbook</span>
                  <ChevronDown className="h-4 w-4 -rotate-90" />
                </Link>
                <button
                  type="button"
                  onClick={scrollToAbout}
                  className="flex items-center justify-between border-b border-black/6 pb-4 text-lg tracking-[0.08em]"
                >
                  <span>About</span>
                  <ChevronDown className="h-4 w-4 -rotate-90" />
                </button>
                <button
                  type="button"
                  onClick={scrollToFooter}
                  className="flex items-center justify-between border-b border-black/6 pb-4 text-lg tracking-[0.08em]"
                >
                  <span>Contact</span>
                  <ChevronDown className="h-4 w-4 -rotate-90" />
                </button>
              </div>

              <div className="mt-8 space-y-3 text-xs uppercase tracking-[0.3em] text-charcoal/60">
                {utilityLinks.map(({ label, Icon }) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => {
                      if (label === 'Search') setSearchOpen(true);
                      if (label === 'Account') router.push('/account');
                    }}
                    className="flex w-full items-center gap-4 border-b border-black/10 bg-white px-1 py-4 text-left transition hover:border-gold hover:text-gold"
                  >
                    <Icon className="h-5 w-5" strokeWidth={1.5} />
                    <span>{label}</span>
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
