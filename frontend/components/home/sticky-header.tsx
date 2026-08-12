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

type HeaderUser = { displayName?: string; firstName?: string; lastName?: string; username?: string; email?: string; role?: 'customer' | 'staff' | 'admin' };
const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL || '';

const mainLinks = [
  { label: 'Lookbooks', href: '/rk-lookbooks' },
] as const;

const collectionLinks = collectionPages;

const utilityLinks = [
  { label: 'Search', Icon: Search },
  { label: 'Wishlist', Icon: Heart },
  { label: 'Account', Icon: UserRound },
  { label: 'Shopping Bag', Icon: ShoppingBag },
] as const;
const navItemClass =
  'border-0 bg-transparent p-0 font-body text-[0.72rem] uppercase tracking-[0.25em] text-current transition duration-500 hover:text-gold';

type StickyHeaderProps = {
  transparentAtTop?: boolean;
};

function AccountPreview({ user, onNavigate }: { user: HeaderUser; onNavigate: () => void }) {
  const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.displayName || user.username || 'RK member';
  return <><p className="text-[10px] uppercase tracking-[0.28em] text-charcoal/45">Signed in as</p><p className="mt-2 font-display text-2xl">{fullName}</p><span className="mt-2 inline-flex rounded-full border border-gold/50 px-2.5 py-1 text-[9px] uppercase tracking-[0.22em] text-gold">{user.role || 'customer'}</span><p className="mt-2 break-all text-xs text-charcoal/50">{user.email || 'No email available'}</p><Link href="/profile" onClick={onNavigate} className="mt-5 block rounded-full bg-ink px-4 py-3 text-center text-[10px] uppercase tracking-[0.2em] text-ivory transition hover:bg-gold">Manage profile</Link>{user.role === 'admin' ? <Link href="/admin" onClick={onNavigate} className="mt-3 block rounded-full border border-gold/60 px-4 py-3 text-center text-[10px] uppercase tracking-[0.2em] text-gold transition hover:bg-gold hover:text-ink">Admin dashboard</Link> : user.role === 'staff' ? <Link href="/staff" onClick={onNavigate} className="mt-3 block rounded-full border border-gold/60 px-4 py-3 text-center text-[10px] uppercase tracking-[0.2em] text-gold transition hover:bg-gold hover:text-ink">Staff dashboard</Link> : <Link href="/account/profile" onClick={onNavigate} className="mt-3 block rounded-full border border-gold/60 px-4 py-3 text-center text-[10px] uppercase tracking-[0.2em] text-gold transition hover:bg-gold hover:text-ink">Client dashboard</Link>}</>;
}

export function StickyHeader({ transparentAtTop = false }: StickyHeaderProps) {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [collectionsOpen, setCollectionsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [wishlistOpen, setWishlistOpen] = useState(false);
  const [bagOpen, setBagOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [accountLoading, setAccountLoading] = useState(false);
  const [accountAttention, setAccountAttention] = useState(false);
  const [accountUser, setAccountUser] = useState<HeaderUser | null>(null);
  const [videoSectionVisible, setVideoSectionVisible] = useState(false);
  // Product cards can populate this list later through a wishlist action.
  const [wishlistItems, setWishlistItems] = useState<typeof collectionPages[number][]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const headerRef = useRef<HTMLElement | null>(null);
  const pathname = usePathname();
  const router = useRouter();
  const isTransparent = ((transparentAtTop && !scrolled) || videoSectionVisible) && !searchOpen;

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const updateVideoVisibility = () => {
      const videoSection = document.getElementById('lookbook');
      if (!videoSection) {
        setVideoSectionVisible(false);
        return;
      }

      const headerHeight = headerRef.current?.getBoundingClientRect().height ?? 0;
      const sectionBounds = videoSection.getBoundingClientRect();
      const hasReachedVideo = sectionBounds.top <= headerHeight;
      const hasPassedVideo = sectionBounds.bottom <= headerHeight;
      setVideoSectionVisible(hasReachedVideo && !hasPassedVideo);
    };

    updateVideoVisibility();
    window.addEventListener('scroll', updateVideoVisibility, { passive: true });
    window.addEventListener('resize', updateVideoVisibility);
    return () => {
      window.removeEventListener('scroll', updateVideoVisibility);
      window.removeEventListener('resize', updateVideoVisibility);
    };
  }, [pathname]);

  useEffect(() => {
    const token = window.localStorage.getItem('rk_access_token');
    if (!token) return;
    fetch(`${apiBaseUrl}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => data?.user && setAccountUser(data.user))
      .catch(() => undefined);
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
    setAccountOpen(false);
  };

  const openAccount = async () => {
    const token = window.localStorage.getItem('rk_access_token');
    if (!token) {
      router.push('/account');
      return;
    }
    setAccountOpen(true);
    if (accountUser || accountLoading) return;
    setAccountLoading(true);
    try {
      const response = await fetch(`${apiBaseUrl}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
      if (response.ok) {
        setAccountUser((await response.json()).user);
      } else if (response.status === 401) {
        window.localStorage.removeItem('rk_access_token');
        window.localStorage.removeItem('rk_auth_user');
        setAccountOpen(false);
        router.push('/account');
      }
    } catch {
      setAccountOpen(false);
    } finally {
      setAccountLoading(false);
    }
  };

  const requireSignIn = (feature: 'wishlist' | 'shopping bag') => {
    if (window.localStorage.getItem('rk_access_token')) return true;
    window.alert(`Please sign in to view your ${feature}.`);
    setMenuOpen(false);
    setAccountAttention(true);
    window.setTimeout(() => setAccountAttention(false), 1200);
    return false;
  };

  const openWishlist = () => {
    if (requireSignIn('wishlist')) setWishlistOpen(true);
  };

  const openBag = () => {
    if (requireSignIn('shopping bag')) setBagOpen(true);
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
    router.push('/about-rk');
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
        'fixed inset-x-0 top-0 z-[200] border-b backdrop-blur-[2px] transition-[background-color,border-color,box-shadow,backdrop-filter] duration-500',
        isTransparent
          ? 'border-transparent bg-transparent text-white shadow-none'
          : 'border-black/6 bg-white text-charcoal shadow-[0_1px_0_rgba(0,0,0,0.04)]',
        scrolled && !isTransparent ? 'shadow-[0_4px_18px_rgba(0,0,0,0.06)]' : ''
      )}
    >
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4 lg:px-10">
        <div className="flex w-full items-center justify-between gap-4 lg:w-auto">
          <Link href="/" className="flex items-center gap-3">
            <img
              src={brandLogoUrl}
              alt="RK Logo"
              width="80"
              height="40"
              className={cn('rk-logo h-10 w-auto', isTransparent && 'rk-logo-on-hero')}
              style={{ width: 'auto', height: '2.5rem', filter: isTransparent ? 'brightness(0) invert(1)' : undefined }}
            />
            <span className="hidden border-l border-current/30 pl-3 text-[0.58rem] uppercase leading-[1.15] tracking-[0.32em] sm:block">Rashi<br />Kapoor</span>
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
                  className="absolute left-1/2 top-full z-50 mt-4 w-[22rem] -translate-x-1/2 border border-black/8 bg-white p-5 text-charcoal shadow-[0_18px_45px_rgba(18,18,18,0.08)]"
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
                        className="flex items-center justify-between border-b border-black/6 pb-3 text-sm uppercase tracking-[0.22em] text-charcoal transition hover:text-gold"
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
          <button type="button" onClick={openWishlist} className="border-0 bg-transparent p-0 text-current transition hover:opacity-70" aria-label="Wishlist">
            <Heart className="h-4 w-4" />
          </button>
          <div className="relative" onMouseEnter={() => accountUser && setAccountOpen(true)} onMouseLeave={() => setAccountOpen(false)}>
            <button type="button" onClick={openAccount} className={cn('border-0 bg-transparent p-0 text-current transition hover:opacity-70', accountAttention && 'animate-[rk-account-blink_1.2s_ease-in-out]')} aria-label="Account" aria-expanded={accountOpen}>
              <UserRound className="h-4 w-4" />
            </button>
            <AnimatePresence>
              {accountOpen ? <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} className="absolute right-0 top-full z-50 mt-4 w-64 border border-black/10 bg-white p-5 text-charcoal shadow-[0_18px_45px_rgba(18,18,18,0.1)]" onMouseEnter={() => setAccountOpen(true)}>
                {accountLoading ? <p className="text-xs text-charcoal/55">Checking your account…</p> : accountUser ? <AccountPreview user={accountUser} onNavigate={() => setAccountOpen(false)} /> : null}
              </motion.div> : null}
            </AnimatePresence>
          </div>
          <button type="button" onClick={openBag} className="border-0 bg-transparent p-0 text-current transition hover:opacity-70" aria-label="Shopping Bag">
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
              className="absolute right-0 top-0 h-[100dvh] w-[88vw] max-w-sm overflow-y-auto overscroll-contain border-l border-black/6 bg-ivory px-6 py-6 text-charcoal shadow-2xl"
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
                  className={cn('rk-logo h-10 w-auto', isTransparent && 'rk-logo-on-hero')}
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
                            className="flex items-center justify-between border-b border-black/6 pb-3 text-sm uppercase tracking-[0.22em] text-charcoal transition hover:text-gold"
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
                <Link href="/rk-lookbooks" onClick={handleNavigation} className="flex items-center justify-between border-b border-black/6 pb-4 text-lg tracking-[0.08em]">
                  <span>Lookbook</span><ChevronDown className="h-4 w-4 -rotate-90" />
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
                      if (label === 'Account') {
                        openAccount();
                      }
                      if (label === 'Wishlist') {
                        setMenuOpen(false);
                        openWishlist();
                      }
                      if (label === 'Shopping Bag') {
                        setMenuOpen(false);
                        openBag();
                      }
                    }}
                    className={cn('flex w-full items-center gap-4 border-b border-black/10 bg-white px-1 py-4 text-left transition hover:border-gold hover:text-gold', label === 'Account' && accountAttention && 'animate-[rk-account-blink_1.2s_ease-in-out]')}
                  >
                    <Icon className="h-5 w-5" strokeWidth={1.5} />
                    <span>{label}</span>
                  </button>
                ))}
              </div>
              {accountOpen ? <div className="mt-5 border border-black/10 bg-ivory p-5 text-charcoal">
                {accountLoading ? <p className="text-xs text-charcoal/55">Checking your account…</p> : accountUser ? <AccountPreview user={accountUser} onNavigate={handleNavigation} /> : null}
              </div> : null}
            </motion.aside>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {wishlistOpen ? (
          <motion.div
            className="fixed inset-0 z-[180] flex items-center justify-center bg-ink/45 px-5 py-8"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setWishlistOpen(false)}
          >
            <motion.section
              role="dialog"
              aria-modal="true"
              aria-labelledby="wishlist-dialog-title"
              className="flex max-h-[86vh] w-full max-w-[27rem] flex-col bg-white text-charcoal shadow-2xl"
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.98 }}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-black/10 px-5 py-4">
                <h2 id="wishlist-dialog-title" className="text-sm font-medium tracking-[0.02em]">
                  Wishlist ({wishlistItems.length} {wishlistItems.length === 1 ? 'item' : 'items'})
                </h2>
                <button type="button" onClick={() => setWishlistOpen(false)} aria-label="Close wishlist">
                  <X className="h-5 w-5 rounded-full border border-black/15 p-1 text-charcoal/60 transition hover:border-gold hover:text-gold" />
                </button>
              </div>
              <div className="overflow-y-auto px-5">
                {wishlistItems.length ? wishlistItems.map((item) => (
                  <div key={item.name} className="flex gap-3 border-b border-black/10 py-4">
                    <Link href={item.route} onClick={() => setWishlistOpen(false)} className="h-16 w-16 shrink-0 overflow-hidden bg-ivory">
                      <img src={item.image} alt={item.name} className="h-full w-full object-cover" />
                    </Link>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <Link href={item.route} onClick={() => setWishlistOpen(false)} className="text-sm leading-5 transition hover:text-gold">
                          {item.name}
                        </Link>
                        <button
                          type="button"
                          onClick={() => setWishlistItems((current) => current.filter((entry) => entry.name !== item.name))}
                          className="shrink-0 text-sm text-charcoal/65 transition hover:text-gold"
                          aria-label={`Remove ${item.name} from wishlist`}
                        >
                          ×
                        </button>
                      </div>
                      <p className="mt-1 text-[0.68rem] text-charcoal/55">{item.status}</p>
                      <Link
                        href={item.route}
                        onClick={() => setWishlistOpen(false)}
                        className="mt-2 inline-flex rounded-full bg-ink px-3 py-1.5 text-[0.62rem] text-white transition hover:bg-gold"
                      >
                        View collection
                      </Link>
                    </div>
                  </div>
                )) : (
                  <div className="flex min-h-[14rem] items-center justify-center text-center text-sm text-charcoal/55">
                    There are no items in this wishlist.
                  </div>
                )}
              </div>
              <div className="border-t border-black/10 px-5 py-4">
                <Link
                  href="/wishlist"
                  onClick={() => setWishlistOpen(false)}
                  className="flex w-full items-center justify-center rounded-full border border-black/20 px-4 py-2.5 text-xs transition hover:border-gold hover:text-gold"
                >
                  View Wishlist
                </Link>
              </div>
            </motion.section>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {bagOpen ? (
          <motion.div
            className="fixed inset-0 z-[180] bg-ink/40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setBagOpen(false)}
          >
            <motion.aside
              role="dialog"
              aria-modal="true"
              aria-labelledby="bag-drawer-title"
              className="absolute right-0 top-0 flex h-full w-full max-w-md flex-col bg-white text-charcoal shadow-2xl"
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-black/10 px-6 py-5">
                <h2 id="bag-drawer-title" className="font-display text-2xl">Shopping Bag</h2>
                <button type="button" onClick={() => setBagOpen(false)} aria-label="Close shopping bag">
                  <X className="h-5 w-5 text-charcoal/60 transition hover:text-gold" />
                </button>
              </div>
              <div className="flex flex-1 items-center justify-center px-8 text-center text-sm text-charcoal/55">
                Your bag is empty.
              </div>
              <div className="border-t border-black/10 px-6 py-5">
                <Link
                  href="/bag"
                  onClick={() => setBagOpen(false)}
                  className="flex w-full items-center justify-center border border-charcoal px-5 py-4 text-xs uppercase tracking-[0.24em] transition hover:border-gold hover:text-gold"
                >
                  View full bag
                </Link>
              </div>
            </motion.aside>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </header>
  );
}
