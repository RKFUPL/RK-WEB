'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { createPortal } from 'react-dom';
import {
  ChevronDown,
  Heart,
  Menu,
  Minus,
  Plus,
  Search,
  ShoppingBag,
  UserRound,
  X,
} from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { brandLogoUrl, collectionGalleryPages, searchItems } from '@/lib/home-content';
import { apiBaseUrl, logout } from '@/lib/rbac';
import { addStoredCartItem, cartChangedEvent, readStoredCart, removeStoredCartItem, updateStoredCartQuantity } from '@/lib/storefront-cart';
import { readWishlist, removeFromWishlist, wishlistChangedEvent, type StorefrontWishlistItem } from '@/lib/storefront-wishlist';
import type { Cart } from '@/lib/store-types';
import { cn } from '@/lib/utils';
import { inr } from '@/lib/catalog';
import { cartLineKey, getCartSubtotal } from '@/lib/cart';

type HeaderUser = { displayName?: string; firstName?: string; lastName?: string; username?: string; email?: string; role?: 'customer' | 'staff' | 'admin' };
const mainLinks = [
  { label: 'Lookbooks', href: '/rk-lookbooks' },
  { label: 'Runway', href: '/runway' },
] as const;

const collectionLinks = collectionGalleryPages;

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
  transparentTheme?: 'light' | 'dark';
};

function AccountPreview({ user, onNavigate }: { user: HeaderUser; onNavigate: () => void }) {
  const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.displayName || user.username || 'RK member';
  return <><p className="text-[10px] uppercase tracking-[0.28em] text-charcoal/45">Signed in as</p><p className="mt-2 font-display text-2xl">{fullName}</p><span className="mt-2 inline-flex rounded-full border border-gold/50 px-2.5 py-1 text-[9px] uppercase tracking-[0.22em] text-gold">{user.role || 'customer'}</span><p className="mt-2 break-all text-xs text-charcoal/50">{user.email || 'No email available'}</p><Link href="/profile" onClick={onNavigate} className="mt-5 block rounded-full bg-ink px-4 py-3 text-center text-[10px] uppercase tracking-[0.2em] text-ivory transition hover:bg-gold">Manage profile</Link>{user.role === 'customer' ? <Link href="/account/orders" onClick={onNavigate} className="mt-3 block rounded-full border border-gold/60 px-4 py-3 text-center text-[10px] uppercase tracking-[0.2em] text-gold transition hover:bg-gold hover:text-ink">My orders</Link> : user.role === 'admin' ? <><Link href="/admin" onClick={onNavigate} className="mt-3 block rounded-full border border-gold/60 px-4 py-3 text-center text-[10px] uppercase tracking-[0.2em] text-gold transition hover:bg-gold hover:text-ink">Admin dashboard</Link><Link href="/admin/orders" onClick={onNavigate} className="mt-3 block rounded-full border border-black/15 px-4 py-3 text-center text-[10px] uppercase tracking-[0.2em] text-charcoal/65 transition hover:border-gold hover:text-gold">View orders</Link></> : user.role === 'staff' ? <><Link href="/staff" onClick={onNavigate} className="mt-3 block rounded-full border border-gold/60 px-4 py-3 text-center text-[10px] uppercase tracking-[0.2em] text-gold transition hover:bg-gold hover:text-ink">Staff dashboard</Link><Link href="/staff/orders" onClick={onNavigate} className="mt-3 block rounded-full border border-black/15 px-4 py-3 text-center text-[10px] uppercase tracking-[0.2em] text-charcoal/65 transition hover:border-gold hover:text-gold">View orders</Link></> : null}<button type="button" onClick={() => { onNavigate(); void logout(); }} className="mt-3 block w-full rounded-full border border-black/15 px-4 py-3 text-center text-[10px] uppercase tracking-[0.2em] text-charcoal/65 transition hover:border-gold hover:text-gold">Sign out</button></>;
}

export function StickyHeader({ transparentAtTop = false, transparentTheme = 'light' }: StickyHeaderProps) {
  const [scrolled, setScrolled] = useState(false);
  const [headerVisible, setHeaderVisible] = useState(true);
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
  const [mounted, setMounted] = useState(false);
  const [wishlistItems, setWishlistItems] = useState<StorefrontWishlistItem[]>([]);
  const [shoppingBag, setShoppingBag] = useState<Cart>({ items: [], currency: 'INR' });
  const [wishlistNotice, setWishlistNotice] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const headerRef = useRef<HTMLElement | null>(null);
  const previousScrollYRef = useRef(0);
  const scrollFrameRef = useRef<number | null>(null);
  const pathname = usePathname();
  const router = useRouter();
  const isHomePage = pathname === '/';
  const isTransparent = ((transparentAtTop && !scrolled) || videoSectionVisible) && !searchOpen;
  const activeTransparentTheme = videoSectionVisible ? 'light' : transparentTheme;
  const transparentLogoIsLight = isTransparent && activeTransparentTheme === 'light';

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const syncBag = () => setShoppingBag(readStoredCart());
    syncBag();
    window.addEventListener(cartChangedEvent, syncBag);
    window.addEventListener('storage', syncBag);
    return () => { window.removeEventListener(cartChangedEvent, syncBag); window.removeEventListener('storage', syncBag); };
  }, []);

  useEffect(() => {
    const syncWishlist = () => setWishlistItems(readWishlist());
    syncWishlist();
    window.addEventListener(wishlistChangedEvent, syncWishlist);
    window.addEventListener('storage', syncWishlist);
    return () => { window.removeEventListener(wishlistChangedEvent, syncWishlist); window.removeEventListener('storage', syncWishlist); };
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

    const updateScrollState = () => {
      const currentScrollY = window.scrollY;

      setScrolled(currentScrollY > 12);
      if (!isHomePage) {
        const previousScrollY = previousScrollYRef.current;
        setHeaderVisible(currentScrollY <= 0 || currentScrollY < previousScrollY);
      }
      previousScrollYRef.current = currentScrollY;
      updateVideoVisibility();
      scrollFrameRef.current = null;
    };

    previousScrollYRef.current = window.scrollY;
    setScrolled(window.scrollY > 12);
    setHeaderVisible(true);
    updateVideoVisibility();

    const onScroll = () => {
      if (scrollFrameRef.current !== null) return;
      scrollFrameRef.current = window.requestAnimationFrame(updateScrollState);
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', updateVideoVisibility);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', updateVideoVisibility);
      if (scrollFrameRef.current !== null) window.cancelAnimationFrame(scrollFrameRef.current);
      scrollFrameRef.current = null;
    };
  }, [isHomePage, pathname]);

  useEffect(() => {
    const token = window.localStorage.getItem('rk_access_token');
    if (!token) return;
    fetch(`${apiBaseUrl}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => data?.user && setAccountUser(data.user))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    document.body.style.overflow = menuOpen || wishlistOpen || bagOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [bagOpen, menuOpen, wishlistOpen]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setWishlistOpen(false);
        setBagOpen(false);
      }
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, []);

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
        window.localStorage.removeItem('rk_auth_token');
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

  const addWishlistItemToBag = (item: StorefrontWishlistItem) => {
    const availability = String(item.availability || '').toLowerCase().replaceAll(' ', '_');
    if (availability === 'sold_out' || item.price === undefined) {
      setWishlistNotice(`${item.name} is not currently available to add.`);
      return;
    }
    if (item.sizeOptions?.length) {
      setWishlistNotice('Choose a size from the product page before adding this piece.');
      setWishlistOpen(false);
      router.push(item.route);
      return;
    }
    const existing = readStoredCart().items.find((cartItem) => cartItem.productId === item.productId);
    if (availability === 'in_stock' && item.stock !== undefined && (existing?.quantity ?? 0) >= item.stock) {
      setWishlistNotice(`Only ${item.stock} available for ${item.name}.`);
      return;
    }
    addStoredCartItem({ productId: item.productId, name: item.name, price: item.price, quantity: 1, image: item.image, stock: item.stock, availability: item.availability });
    setWishlistNotice(`${item.name} added to your bag.`);
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
    router.push('/about');
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
        'fixed inset-x-0 top-0 z-[200] border-b backdrop-blur-[2px] transition-[background-color,border-color,box-shadow,backdrop-filter,transform] duration-500 ease-out',
        isTransparent
          ? cn('border-transparent bg-transparent shadow-none', activeTransparentTheme === 'dark' ? 'text-[#1e1b18]' : 'text-white')
          : 'border-black/6 bg-white text-charcoal shadow-[0_1px_0_rgba(0,0,0,0.04)]',
        scrolled && !isTransparent ? 'shadow-[0_4px_18px_rgba(0,0,0,0.06)]' : '',
        isHomePage || headerVisible || searchOpen || menuOpen || wishlistOpen || bagOpen || accountOpen ? 'translate-y-0' : '-translate-y-full'
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
              className={cn('rk-logo h-10 w-auto', transparentLogoIsLight && 'rk-logo-on-hero', isTransparent && activeTransparentTheme === 'dark' && 'rk-logo-on-light-hero')}
              style={{ width: 'auto', height: '2.5rem', filter: transparentLogoIsLight ? 'brightness(0) invert(1)' : undefined }}
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
              aria-current={pathname === item.href ? 'page' : undefined}
              className={cn(navItemClass, pathname === item.href && 'text-gold')}
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
                  className="rk-logo h-10 w-auto"
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
                <Link href="/runway" onClick={handleNavigation} aria-current={pathname === '/runway' ? 'page' : undefined} className={`flex items-center justify-between border-b border-black/6 pb-4 text-lg tracking-[0.08em] ${pathname === '/runway' ? 'text-gold' : ''}`}>
                  <span>Runway</span><ChevronDown className="h-4 w-4 -rotate-90" />
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
                  <div key={label}>
                  <button
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
                  {label === 'Account' && accountOpen ? (
                    <div className="mt-3 border border-black/10 bg-ivory p-5 text-charcoal">
                      {accountLoading ? <p className="text-xs text-charcoal/55">Checking your account…</p> : accountUser ? <AccountPreview user={accountUser} onNavigate={handleNavigation} /> : null}
                    </div>
                  ) : null}
                  </div>
                ))}
              </div>
              {/*
                {accountLoading ? <p className="text-xs text-charcoal/55">Checking your account…</p> : accountUser ? <AccountPreview user={accountUser} onNavigate={handleNavigation} /> : null}
              */}
            </motion.aside>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {wishlistOpen ? (
          <motion.div
            className="fixed inset-0 z-[300] bg-black/60"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setWishlistOpen(false)}
          >
            <motion.section
              role="dialog"
              aria-modal="true"
              aria-labelledby="wishlist-dialog-title"
              className="fixed inset-y-0 right-0 isolate flex h-[100dvh] min-h-[100dvh] w-full max-w-md flex-col overflow-hidden bg-[#fffdf9] text-charcoal shadow-2xl dark:bg-[#121212] dark:text-white"
              initial={{ opacity: 0, x: '100%', scale: 1 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: '100%', scale: 1 }}
              transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-black/10 bg-[#fffdf9] px-6 py-5 dark:border-white/10 dark:bg-[#121212]">
                <h2 id="wishlist-dialog-title" className="font-display text-2xl">
                  Wishlist{wishlistItems.length ? ` (${wishlistItems.length})` : ''}
                </h2>
                <button type="button" onClick={() => setWishlistOpen(false)} aria-label="Close wishlist">
                  <X className="h-5 w-5 rounded-full border border-black/15 p-1 text-charcoal/60 transition hover:border-gold hover:text-gold" />
                </button>
              </div>
              <div className={`min-h-0 flex-1 overflow-y-auto bg-[#fffdf9] dark:bg-[#121212] ${wishlistItems.length ? 'px-6' : 'flex items-center justify-center px-8 text-center text-sm text-charcoal/55 dark:text-white/60'}`}>
                {wishlistItems.length ? wishlistItems.map((item) => (
                  <div key={item.productId} className="flex gap-4 border-b border-black/10 py-5 dark:border-white/10">
                    <Link href={item.route} onClick={() => setWishlistOpen(false)} className="h-24 w-20 shrink-0 overflow-hidden rounded-[12px] bg-sand">
                      {item.image ? <img src={item.image} alt={item.name} className="h-full w-full object-cover" /> : null}
                    </Link>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <Link href={item.route} onClick={() => setWishlistOpen(false)} className="text-sm leading-5 transition hover:text-gold">
                          {item.name}
                        </Link>
                        <button
                          type="button"
                          onClick={() => removeFromWishlist(item.productId)}
                          className="shrink-0 text-sm text-charcoal/65 transition hover:text-gold"
                          aria-label={`Remove ${item.name} from wishlist`}
                        >
                          ×
                        </button>
                      </div>
                      <p className="mt-1 text-[0.68rem] text-charcoal/55 dark:text-white/55">{item.category || 'Couture'}</p>
                      <p className="mt-1 text-xs text-charcoal/70 dark:text-white/70">{item.price === undefined ? 'Price on request' : inr.format(item.price)}</p>
                      <p className="mt-1 text-[0.62rem] text-charcoal/55 dark:text-white/55">{item.availability || 'Available on request'}</p>
                      <div className="mt-3 flex flex-wrap gap-3">
                        <button type="button" disabled={String(item.availability || '').toLowerCase().replaceAll(' ', '_') === 'sold_out'} onClick={() => addWishlistItemToBag(item)} className="rounded-full bg-ink px-3 py-1.5 text-[0.62rem] text-white transition hover:bg-gold disabled:cursor-not-allowed disabled:opacity-45">Add to Bag</button>
                        <Link href={item.route} onClick={() => setWishlistOpen(false)} className="inline-flex items-center text-[0.62rem] uppercase tracking-[0.16em] text-gold">View Piece</Link>
                      </div>
                    </div>
                  </div>
                )) : (
                  <div className="flex min-h-[14rem] flex-col items-center justify-center text-center text-charcoal/55 dark:text-white/60">
                    <Heart className="h-7 w-7 text-gold" strokeWidth={1.25} />
                    <p className="mt-5 font-display text-2xl text-charcoal dark:text-white">Your wishlist is waiting for something special.</p>
                    <Link href="/collections" onClick={() => setWishlistOpen(false)} className="mt-6 border-b border-charcoal/40 pb-2 text-[0.6rem] uppercase tracking-[0.25em] text-charcoal dark:border-white/40 dark:text-white">Explore Collections</Link>
                  </div>
                )}
              </div>
              {wishlistNotice ? <p className="border-t border-black/10 bg-[#fffdf9] px-6 py-3 text-xs text-gold dark:border-white/10 dark:bg-[#121212]">{wishlistNotice}</p> : null}
              <div className="border-t border-black/10 bg-[#fffdf9] px-6 py-5 dark:border-white/10 dark:bg-[#121212]">
                <Link
                  href="/wishlist"
                  onClick={() => setWishlistOpen(false)}
                  className="flex w-full items-center justify-center border border-charcoal px-5 py-4 text-xs uppercase tracking-[0.24em] transition hover:border-gold hover:text-gold dark:border-white/60"
                >
                  View Wishlist
                </Link>
              </div>
            </motion.section>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {mounted ? createPortal(<AnimatePresence>
        {bagOpen ? (
          <motion.div
            className="fixed inset-0 z-[300] bg-black/60"
            onClick={() => setBagOpen(false)}
          >
            <motion.aside
              role="dialog"
              aria-modal="true"
              aria-labelledby="bag-drawer-title"
              className="shopping-bag-panel fixed inset-y-0 right-0 isolate flex h-[100dvh] min-h-[100dvh] w-full max-w-md flex-col overflow-hidden bg-[#fffdf9] text-charcoal opacity-100 shadow-2xl dark:bg-[#121212] dark:text-white"
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-black/10 bg-[#fffdf9] px-6 py-5 dark:border-white/10 dark:bg-[#121212]">
                <h2 id="bag-drawer-title" className="font-display text-2xl">Shopping Bag</h2>
                <button type="button" onClick={() => setBagOpen(false)} aria-label="Close shopping bag">
                  <X className="h-5 w-5 text-charcoal/60 transition hover:text-gold dark:text-white/60" />
                </button>
              </div>
              <div className={`min-h-0 flex-1 overflow-y-auto bg-[#fffdf9] dark:bg-[#121212] ${shoppingBag.items.length ? 'px-6' : 'flex items-center justify-center px-8 text-center text-sm text-charcoal/55 dark:text-white/60'}`}>
                {shoppingBag.items.length ? shoppingBag.items.map((item) => { const lineKey = cartLineKey(item); return <div key={lineKey} className="flex gap-4 border-b border-black/10 py-5 dark:border-white/10"><div className="h-24 w-20 shrink-0 overflow-hidden rounded-[12px] bg-sand">{item.image ? <img src={item.image} alt={item.name} className="h-full w-full object-cover" /> : null}</div><div className="min-w-0 flex-1"><p className="font-display text-lg">{item.name}</p>{item.variant ? <p className="mt-1 text-[0.6rem] uppercase tracking-[0.18em] text-charcoal/50 dark:text-white/50">{item.variant.name}: {item.variant.value}</p> : null}{item.customSize ? <p className="mt-1 text-[0.6rem] uppercase tracking-[0.18em] text-charcoal/50 dark:text-white/50">Custom size · {item.customSize.unit}</p> : null}<p className="mt-2 text-xs text-charcoal/70 dark:text-white/70">Unit price: {inr.format(item.price)}</p><p className="mt-1 text-xs text-charcoal/70 dark:text-white/70">Subtotal: {inr.format(item.price * item.quantity)}</p><div className="mt-3 flex items-center gap-2"><button type="button" onClick={() => updateStoredCartQuantity(item.productId, item.quantity - 1, item.variant?.id, lineKey)} aria-label={`Decrease quantity of ${item.name}`} className="grid h-8 w-8 place-items-center border border-black/15 transition hover:text-gold dark:border-white/20"><Minus size={13} /></button><span className="min-w-6 text-center text-xs">{item.quantity}</span><button type="button" disabled={item.availability?.toLowerCase().replaceAll(' ', '_') === 'in_stock' && item.stock !== undefined && item.quantity >= item.stock} onClick={() => updateStoredCartQuantity(item.productId, item.quantity + 1, item.variant?.id, lineKey)} aria-label={`Increase quantity of ${item.name}`} className="grid h-8 w-8 place-items-center border border-black/15 transition hover:text-gold disabled:cursor-not-allowed disabled:opacity-35 dark:border-white/20"><Plus size={13} /></button></div><button type="button" onClick={() => removeStoredCartItem(item.productId, item.variant?.id, lineKey)} className="mt-3 text-[0.55rem] uppercase tracking-[0.2em] text-gold">Remove</button></div></div>; }) : <div className="flex min-h-full flex-col items-center justify-center gap-4 text-center"><ShoppingBag className="h-7 w-7 text-gold" strokeWidth={1.25} /><p>Your bag is empty.</p><Link href="/collections" onClick={() => setBagOpen(false)} className="border-b border-charcoal/40 pb-2 text-[0.6rem] uppercase tracking-[0.25em] dark:border-white/40">Explore Collections</Link></div>}
              </div>
              <div className="border-t border-black/10 bg-[#fffdf9] px-6 py-5 dark:border-white/10 dark:bg-[#121212]">
                {shoppingBag.items.length ? <div className="mb-4 flex items-center justify-between text-sm"><span>Subtotal</span><span>{inr.format(getCartSubtotal(shoppingBag))}</span></div> : null}
                <div className="grid gap-3 sm:grid-cols-2">
                  <Link href="/checkout" onClick={() => setBagOpen(false)} aria-disabled={!shoppingBag.items.length} className={`flex w-full items-center justify-center bg-ink px-5 py-4 text-xs uppercase tracking-[0.24em] text-ivory transition hover:bg-gold hover:text-ink ${!shoppingBag.items.length ? 'pointer-events-none opacity-40' : ''}`}>Checkout</Link>
                  <Link href="/bag" onClick={() => setBagOpen(false)} className="flex w-full items-center justify-center border border-charcoal px-5 py-4 text-xs uppercase tracking-[0.24em] transition hover:border-gold hover:text-gold dark:border-white/60">View full bag</Link>
                </div>
              </div>
            </motion.aside>
          </motion.div>
        ) : null}
      </AnimatePresence>, document.body) : null}
    </header>
  );
}
