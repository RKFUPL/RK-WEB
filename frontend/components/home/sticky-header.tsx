'use client';

import Link from 'next/link';
import { SaleAmount } from '@/components/commerce/sale-amount';
import { SaleAnnouncement } from '@/components/commerce/sale-announcement';
import { SaleNavigation } from '@/components/commerce/sale-navigation';
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
import { brandLogoUrl, searchItems, lookbookCovers, popularSearchTerms } from '@/lib/home-content';
import { apiBaseUrl, logout } from '@/lib/rbac';
import { fetchCatalogCollections, searchCatalogProducts, type CatalogSearchProduct } from '@/lib/catalog-client';
import { refreshStoredCartPrices, cartChangedEvent, readStoredCart, removeStoredCartItem, updateStoredCartQuantity } from '@/lib/storefront-cart';
import { readWishlist, removeFromWishlist, wishlistChangedEvent, type StorefrontWishlistItem } from '@/lib/storefront-wishlist';
import type { Cart } from '@/lib/store-types';
import { cn } from '@/lib/utils';
import { useCurrency } from '@/components/commerce/currency-provider';
import { ShippingTimeline } from '@/components/commerce/shipping-timeline';
import { cartItemShippingTimeline } from '@/lib/shipping-timeline';
import { cartLineKey, getCartSubtotal } from '@/lib/cart';
import { matchesSearch } from '@/lib/storefront-search';

type HeaderUser = { displayName?: string; firstName?: string; lastName?: string; username?: string; email?: string; role?: 'customer' | 'staff' | 'admin' };
const mainLinks = [
  { label: 'Shop', href: '/shop' },
  { label: 'Lookbooks', href: '/rk-lookbooks' },
  { label: 'Runway', href: '/runway' },
] as const;

const utilityLinks = [
  { label: 'Search', Icon: Search },
  { label: 'Wishlist', Icon: Heart },
  { label: 'Account', Icon: UserRound },
  { label: 'Shopping Bag', Icon: ShoppingBag },
] as const;
const navItemClass =
  'border-0 bg-transparent p-0 font-body text-[0.78rem] uppercase tracking-[0.24em] text-current transition duration-500 hover:text-gold';

type StickyHeaderProps = {
  transparentAtTop?: boolean;
  transparentTheme?: 'light' | 'dark';
};

function AccountPreview({ user, onNavigate }: { user: HeaderUser; onNavigate: () => void }) {
  const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.displayName || user.username || 'RK member';
  return <><p className="text-[10px] uppercase tracking-[0.28em] text-charcoal/45">Signed in as</p><p className="mt-2 font-display text-2xl">{fullName}</p><span className="mt-2 inline-flex rounded-full border border-gold/50 px-2.5 py-1 text-[9px] uppercase tracking-[0.22em] text-gold">{user.role || 'customer'}</span><p className="mt-2 break-all text-xs text-charcoal/50">{user.email || 'No email available'}</p><Link href="/profile" onClick={onNavigate} className="mt-5 block rounded-full bg-ink px-4 py-3 text-center text-[10px] uppercase tracking-[0.2em] text-ivory transition hover:bg-gold">Manage profile</Link>{user.role === 'customer' ? <Link href="/account/orders" onClick={onNavigate} className="mt-3 block rounded-full border border-gold/60 px-4 py-3 text-center text-[10px] uppercase tracking-[0.2em] text-gold transition hover:bg-gold hover:text-ink">My orders</Link> : user.role === 'admin' ? <><Link href="/admin" onClick={onNavigate} className="mt-3 block rounded-full border border-gold/60 px-4 py-3 text-center text-[10px] uppercase tracking-[0.2em] text-gold transition hover:bg-gold hover:text-ink">Admin dashboard</Link><Link href="/admin/orders" onClick={onNavigate} className="mt-3 block rounded-full border border-black/15 px-4 py-3 text-center text-[10px] uppercase tracking-[0.2em] text-charcoal/65 transition hover:border-gold hover:text-gold">View orders</Link></> : user.role === 'staff' ? <><Link href="/staff" onClick={onNavigate} className="mt-3 block rounded-full border border-gold/60 px-4 py-3 text-center text-[10px] uppercase tracking-[0.2em] text-gold transition hover:bg-gold hover:text-ink">Staff dashboard</Link><Link href="/staff/orders" onClick={onNavigate} className="mt-3 block rounded-full border border-black/15 px-4 py-3 text-center text-[10px] uppercase tracking-[0.2em] text-charcoal/65 transition hover:border-gold hover:text-gold">View orders</Link></> : null}<button type="button" onClick={() => { onNavigate(); void logout(); }} className="mt-3 block w-full rounded-full border border-black/15 px-4 py-3 text-center text-[10px] uppercase tracking-[0.2em] text-charcoal/65 transition hover:border-gold hover:text-gold">Sign out</button></>;
}

export function StickyHeader({ transparentAtTop = false, transparentTheme = 'light' }: StickyHeaderProps) {
  const { formatPrice } = useCurrency();
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
  const [productResults, setProductResults] = useState<CatalogSearchProduct[]>([]);
  const [productSearchState, setProductSearchState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [collectionSearchError, setCollectionSearchError] = useState(false);
  const [collectionLinks, setCollectionLinks] = useState<Array<{ id: string; name: string; slug: string; route: string; summary: string }>>([]);
  const searchVersionRef = useRef(0);
  const [searchSubmission, setSearchSubmission] = useState(0);
  const searchPanelRef = useRef<HTMLElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchTriggerRef = useRef<HTMLElement | null>(null);
  const searchOpenRef = useRef(false);
  searchOpenRef.current = searchOpen;
  const closeSearch = () => {
    searchVersionRef.current += 1;
    setSearchOpen(false);
    setSearchQuery('');
    setProductResults([]);
    setProductSearchState('idle');
  };
  const openSearch = () => {
    searchTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    loadCollectionLinks();
    setSearchOpen(true);
  };
  const submitSearch = () => {
    if (!searchQuery.trim()) { searchInputRef.current?.focus(); return; }
    searchVersionRef.current += 1;
    setProductResults([]);
    setProductSearchState('loading');
    setSearchSubmission((value) => value + 1);
  };
  const headerRef = useRef<HTMLElement | null>(null);
  const previousScrollYRef = useRef(0);
  const scrollFrameRef = useRef<number | null>(null);
  const pathname = usePathname();
  const router = useRouter();
  const isHomePage = pathname === '/';
  const isTransparent = (transparentAtTop && !scrolled) || videoSectionVisible;
  const activeTransparentTheme = videoSectionVisible ? 'light' : transparentTheme;
  const transparentLogoIsLight = isTransparent && activeTransparentTheme === 'light';

  useEffect(() => {
    setMounted(true);
  }, []);

  const loadCollectionLinks = () => {
    if (collectionLinks.length) return;
    setCollectionSearchError(false);
    void fetchCatalogCollections()
      .then((collections) => setCollectionLinks(collections.map((collection) => ({ id: collection.id, name: collection.name, slug: collection.slug, route: `/collections/${collection.slug}`, summary: collection.description || '' }))))
      .catch(() => { setCollectionLinks([]); setCollectionSearchError(true); });
  };

  const updateSearchQuery = (value: string) => {
    searchVersionRef.current += 1;
    setProductResults([]);
    setSearchQuery(value);
    setProductSearchState(value.trim() ? 'loading' : 'idle');
  };

  useEffect(() => {
    const query = searchQuery.trim();
    if (!searchOpen || !query) {
      setProductResults([]);
      setProductSearchState('idle');
      return;
    }
    const controller = new AbortController();
    const version = searchVersionRef.current;
    setProductResults([]);
    setProductSearchState('loading');
    const timer = window.setTimeout(() => {
      void searchCatalogProducts(query, controller.signal)
        .then((products) => {
          if (!controller.signal.aborted && version === searchVersionRef.current) {
            setProductResults(products);
            setProductSearchState('ready');
          }
        })
        .catch(() => {
          if (!controller.signal.aborted && version === searchVersionRef.current) setProductSearchState('error');
        });
    }, 300);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [searchOpen, searchQuery, searchSubmission]);

  useEffect(() => {
    const syncBag = () => setShoppingBag(readStoredCart());
    syncBag();
    void refreshStoredCartPrices();
    const refreshPrices = () => { void refreshStoredCartPrices(); };
    window.addEventListener('rk-sale-state-refresh', refreshPrices);
    const priceTimer = window.setInterval(() => void refreshStoredCartPrices(), 30000);
    window.addEventListener(cartChangedEvent, syncBag);
    window.addEventListener('storage', syncBag);
    return () => { window.removeEventListener('rk-sale-state-refresh', refreshPrices); window.clearInterval(priceTimer); window.removeEventListener(cartChangedEvent, syncBag); window.removeEventListener('storage', syncBag); };
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
      if (searchOpenRef.current) { scrollFrameRef.current = null; return; }
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

  const scrollLocked = menuOpen || wishlistOpen || bagOpen || searchOpen;
  useEffect(() => {
    if (!scrollLocked) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, [scrollLocked]);

  useEffect(() => {
    if (!searchOpen) return;
    const panel = searchPanelRef.current;
    const trigger = searchTriggerRef.current;
    searchInputRef.current?.focus();
    const focusable = () => Array.from(panel?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), [tabindex="0"]') || []).filter((node) => node.getClientRects().length);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); closeSearch(); }
      if (event.key === 'Tab') {
        const nodes = focusable();
        const first = nodes[0]; const last = nodes[nodes.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    const onFocus = (event: FocusEvent) => {
      if (!panel?.contains(event.target as Node)) searchInputRef.current?.focus();
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('focusin', onFocus);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('focusin', onFocus);
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
  }, [searchOpen]);

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

  const openCollections = () => { loadCollectionLinks(); setCollectionsOpen(true); };
  const closeCollections = () => setCollectionsOpen(false);

  const handleNavigation = () => {
    setMenuOpen(false);
    setCollectionsOpen(false);
    closeSearch();
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
    setWishlistNotice('Choose the colour and size from the product page.');
    setWishlistOpen(false);
    router.push(item.route);
  };

  const searchResults = useMemo(() => {
    const collections = [
      ...collectionLinks.map((collection) => ({ title: collection.name, href: collection.route, keywords: `${collection.name} ${collection.slug} ${collection.summary}` })),
      ...searchItems.filter((item) => item.type === 'Collection' && item.title === 'All Collections'),
    ];
    const pages = [
      ...searchItems.filter((item) => item.type !== 'Collection'),
      ...lookbookCovers.map((item) => ({ title: `${item.title} Lookbook`, href: item.href, keywords: `${item.title} lookbook editorial` })),
    ];
    return {
      collections: collections.filter((item) => matchesSearch(`${item.title} ${item.keywords}`, searchQuery)),
      pages: pages.filter((item) => matchesSearch(`${item.title} ${item.keywords}`, searchQuery)),
    };
  }, [collectionLinks, searchQuery]);

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
        'fixed inset-x-0 top-0 z-[200] border-b transition-[background-color,border-color,box-shadow,backdrop-filter,transform] duration-500 ease-out',
        !isTransparent && 'backdrop-blur-[2px]',
        isTransparent
          ? cn('border-transparent bg-transparent shadow-none', activeTransparentTheme === 'dark' ? 'text-[#1e1b18]' : 'text-white')
          : 'border-black/6 bg-white text-charcoal shadow-[0_1px_0_rgba(0,0,0,0.04)]',
        scrolled && !isTransparent ? 'shadow-[0_4px_18px_rgba(0,0,0,0.06)]' : '',
        isHomePage || headerVisible || searchOpen || menuOpen || wishlistOpen || bagOpen || accountOpen ? 'translate-y-0' : '-translate-y-full'
      )}
    >
      <SaleAnnouncement />
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4 lg:px-10 lg:py-[1.125rem]">
        <div className="flex w-full items-center justify-between gap-4 lg:w-auto">
          <Link href="/" className="flex items-center gap-3">
            <img
              src={brandLogoUrl}
              alt="RK Logo"
              width="80"
              height="40"
              className={cn('rk-logo h-11 w-auto lg:h-12', transparentLogoIsLight && 'rk-logo-on-hero', isTransparent && activeTransparentTheme === 'dark' && 'rk-logo-on-light-hero')}
              style={{ width: 'auto', filter: transparentLogoIsLight ? 'brightness(0) invert(1)' : undefined }}
            />
            <span className="hidden border-l border-current/30 pl-3 text-[0.64rem] uppercase leading-[1.18] tracking-[0.3em] sm:block">Rashi<br />Kapoor</span>
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

        <nav className="hidden items-center gap-9 lg:flex">
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
                        key={collection.id}
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
          <SaleNavigation className={navItemClass} onNavigate={handleNavigation} />
        </nav>

        <div className="hidden items-center gap-6 lg:flex">
          <button
            type="button"
            onClick={openSearch}
            className="border-0 bg-transparent p-0 text-current transition hover:opacity-70"
            aria-label="Search"
          >
            <Search className="h-[1.15rem] w-[1.15rem]" />
          </button>
          <button type="button" onClick={openWishlist} className="border-0 bg-transparent p-0 text-current transition hover:opacity-70" aria-label="Wishlist">
            <Heart className="h-[1.15rem] w-[1.15rem]" />
          </button>
          <div className="relative" onMouseEnter={() => accountUser && setAccountOpen(true)} onMouseLeave={() => setAccountOpen(false)}>
            <button type="button" onClick={openAccount} className={cn('border-0 bg-transparent p-0 text-current transition hover:opacity-70', accountAttention && 'animate-[rk-account-blink_1.2s_ease-in-out]')} aria-label="Account" aria-expanded={accountOpen}>
              <UserRound className="h-[1.15rem] w-[1.15rem]" />
            </button>
            <AnimatePresence>
              {accountOpen ? <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} className="absolute right-0 top-full z-50 mt-4 w-64 border border-black/10 bg-white p-5 text-charcoal shadow-[0_18px_45px_rgba(18,18,18,0.1)]" onMouseEnter={() => setAccountOpen(true)}>
                {accountLoading ? <p className="text-xs text-charcoal/55">Checking your account…</p> : accountUser ? <AccountPreview user={accountUser} onNavigate={() => setAccountOpen(false)} /> : null}
              </motion.div> : null}
            </AnimatePresence>
          </div>
          <button type="button" onClick={openBag} className="border-0 bg-transparent p-0 text-current transition hover:opacity-70" aria-label="Shopping Bag">
            <ShoppingBag className="h-[1.15rem] w-[1.15rem]" />
          </button>
        </div>
      </div>

      {mounted && searchOpen ? createPortal(
        <div data-search-overlay className="fixed inset-0 z-[500] flex items-start justify-center overflow-y-auto overscroll-contain bg-ink/35 px-3 py-6 text-charcoal backdrop-blur-[2px] sm:px-8 sm:py-16" onClick={(event) => { if (event.target === event.currentTarget) closeSearch(); }}>
          <section ref={searchPanelRef} role="dialog" aria-modal="true" aria-labelledby="storefront-search-title" className="relative my-auto max-h-[calc(100dvh-3rem)] w-full max-w-6xl overflow-y-auto overscroll-contain bg-ivory px-5 py-6 shadow-[0_24px_90px_rgba(30,25,20,.2)] sm:max-h-[calc(100dvh-8rem)] sm:px-10 sm:py-8">
            <div className="mb-5 flex items-center justify-between gap-4">
              <h2 id="storefront-search-title" className="text-[11px] uppercase tracking-[.25em] text-gold">Search the house</h2>
              <button type="button" onClick={closeSearch} aria-label="Close search" className="p-2 transition hover:text-gold focus-visible:outline focus-visible:outline-gold"><X size={20} /></button>
            </div>
            <form role="search" onSubmit={(event) => { event.preventDefault(); submitSearch(); }} className="mx-auto flex max-w-3xl items-center gap-2 border-b border-charcoal/25 pb-3 sm:gap-4">
              <Search aria-hidden="true" className="hidden h-5 w-5 shrink-0 text-gold sm:block" />
              <input ref={searchInputRef} value={searchQuery} onChange={(event) => updateSearchQuery(event.target.value)} placeholder="Search products, collections, lookbooks..." className="min-w-0 flex-1 bg-transparent py-2 text-base text-charcoal placeholder:text-charcoal/45 focus-visible:outline focus-visible:outline-1 focus-visible:outline-gold sm:text-xl" aria-label="Search products, collections, and pages" />
              {searchQuery ? <button type="button" onClick={() => { updateSearchQuery(''); searchInputRef.current?.focus(); }} aria-label="Clear search query" className="shrink-0 p-2 hover:text-gold focus-visible:outline focus-visible:outline-gold"><X size={16} /></button> : null}
              <button type="submit" aria-label="Submit search" className="shrink-0 p-2 text-gold focus-visible:outline focus-visible:outline-gold"><Search size={22} /></button>
            </form>
            {!searchQuery.trim() ? <section className="py-8" aria-labelledby="popular-searches-title">
              <h3 id="popular-searches-title" className="text-xs uppercase tracking-[.2em]">Popular Searches</h3>
              <div className="mt-5 flex flex-wrap gap-x-7 gap-y-4 text-sm">{Array.from(new Set([...collectionLinks.map((item) => item.name), ...popularSearchTerms])).slice(0, 10).map((term) => <button key={term} type="button" onClick={() => updateSearchQuery(term)} className="border-b border-gold/30 pb-1 hover:text-gold focus-visible:outline focus-visible:outline-gold">{term}</button>)}</div>
            </section> : <div aria-live="polite" aria-busy={productSearchState === 'loading'} className="mt-8">
              {productSearchState === 'loading' ? <p className="mb-5 text-sm text-charcoal/60">Searching products…</p> : null}
              {productSearchState === 'error' ? <p role="alert" className="mb-5 text-sm text-red-700">Product search could not be loaded. Please try again.</p> : null}
              {collectionSearchError ? <p role="alert" className="mb-5 text-sm text-red-700">Collections could not be loaded. Please try again.</p> : null}
              <div className="grid gap-8 md:grid-cols-[.8fr_1fr_1.6fr]">
                <section aria-labelledby="search-suggestions-title"><h3 id="search-suggestions-title" className="border-b border-black/10 pb-3 text-xs uppercase tracking-[.2em]">Suggestions</h3>
                  <div className="mt-4 space-y-3">{Array.from(new Set([...collectionLinks.map((item) => item.name), ...popularSearchTerms, ...productResults.flatMap((item) => item.name ? [item.name] : [])])).filter((term) => matchesSearch(term, searchQuery)).slice(0, 8).map((term) => <button type="button" key={term} onClick={() => { updateSearchQuery(term); setSearchSubmission((value) => value + 1); }} className="block text-left text-sm hover:text-gold focus-visible:outline focus-visible:outline-gold">{term}</button>)}</div>
                </section>
                <section aria-labelledby="search-pages-title"><h3 id="search-pages-title" className="border-b border-black/10 pb-3 text-xs uppercase tracking-[.2em]">Pages</h3>
                  {searchResults.collections.length ? <h4 className="mt-4 text-xs text-charcoal/55">Collections</h4> : null}
                  {[...searchResults.collections, ...searchResults.pages].map((item) => <Link key={item.href} href={item.href} onClick={handleNavigation} className="block break-words py-3 text-sm hover:text-gold focus-visible:outline focus-visible:outline-gold">{item.title}</Link>)}
                </section>
                <section aria-labelledby="search-products-title"><h3 id="search-products-title" className="border-b border-black/10 pb-3 text-xs uppercase tracking-[.2em]">Products</h3>
                  <div className="divide-y divide-black/10">{productResults.map((product) => <Link key={product.id} href={`/products/${encodeURIComponent(product.id)}`} onClick={handleNavigation} className="flex items-center gap-4 py-3 hover:text-gold focus-visible:outline focus-visible:outline-gold">
                    {product.media?.[0] ? <img src={product.media[0]} alt="" width="56" height="72" className="h-[72px] w-14 shrink-0 bg-sand object-cover" /> : <span aria-hidden="true" className="h-[72px] w-14 shrink-0 bg-sand" />}
                    <span className="min-w-0"><span className="block break-words font-display text-lg">{product.name || 'RK piece'}</span><span className="block break-words text-xs text-charcoal/55">{product.productCode || product.parentSku || product.sku}{product.collections?.[0]?.name ? ` · ${product.collections[0].name}` : ''}</span></span>
                  </Link>)}</div>
                </section>
              </div>
              {productSearchState === 'ready' && !collectionSearchError && !productResults.length && !searchResults.collections.length && !searchResults.pages.length ? <p className="py-6 text-sm text-charcoal/60">No matching products, collections or pages found.</p> : null}
            </div>}
          </section>
        </div>, document.body
      ) : null}

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
                <button
                  type="button"
                  onClick={scrollToHome}
                  className="flex items-center justify-between border-b border-black/6 pb-4 text-lg tracking-[0.08em]"
                >
                  <span>Home</span>
                  <ChevronDown className="h-4 w-4 -rotate-90" />
                </button>
                <div>
                  <div className="flex items-center justify-between border-b border-black/6 pb-4 text-lg tracking-[0.08em]">
                    <Link href="/collections" onClick={handleNavigation} className="flex-1">
                      Collections
                    </Link>
                    <button
                      type="button"
                      onClick={() => { loadCollectionLinks(); setCollectionsOpen((current) => !current); }}
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
                              key={collection.id}
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
                <Link href="/shop" onClick={handleNavigation} aria-current={pathname === '/shop' ? 'page' : undefined} className={`flex items-center justify-between border-b border-black/6 pb-4 text-lg tracking-[0.08em] ${pathname === '/shop' ? 'text-gold' : ''}`}>
                  <span>Shop</span><ChevronDown className="h-4 w-4 -rotate-90" />
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
                <SaleNavigation className="flex border-b border-black/6 pb-4 text-lg tracking-[0.08em]" onNavigate={handleNavigation} />
              </div>

              <div className="mt-8 space-y-3 text-xs uppercase tracking-[0.3em] text-charcoal/60">
                {utilityLinks.map(({ label, Icon }) => (
                  <div key={label}>
                  <button
                    type="button"
                    onClick={() => {
                      if (label === 'Search') openSearch();
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
              className="fixed left-1/2 top-24 isolate flex max-h-[calc(100dvh-7rem)] w-[min(92vw,32rem)] -translate-x-1/2 flex-col overflow-hidden rounded-[18px] bg-[#fffdf9] text-charcoal shadow-2xl dark:bg-[#121212] dark:text-white"
              initial={{ opacity: 0, y: -18, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -18, scale: 0.97 }}
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
                  <div key={`${item.productId}:${item.sku || item.variantId || 'default'}`} className="flex gap-4 border-b border-black/10 py-5 dark:border-white/10">
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
                          onClick={() => removeFromWishlist(item.productId, item.sku)}
                          className="shrink-0 text-sm text-charcoal/65 transition hover:text-gold"
                          aria-label={`Remove ${item.name} from wishlist`}
                        >
                          ×
                        </button>
                      </div>
                      <p className="mt-1 text-[0.68rem] text-charcoal/55 dark:text-white/55">{item.category || 'Couture'}</p>
                      {item.colour || item.sku ? <p className="mt-1 text-[0.62rem] uppercase tracking-[0.14em] text-charcoal/55 dark:text-white/55">{item.colour || 'Colour'}{item.sku ? ` · ${item.sku}` : ''}</p> : null}
                      <p className="mt-1 text-xs text-charcoal/70 dark:text-white/70">{formatPrice(item.price)}</p>
                      <p className="mt-1 text-[0.62rem] text-charcoal/55 dark:text-white/55">{item.availability || 'Available on request'}</p>
                      {item.sizeOptions?.length ? <p className="mt-2 text-[0.62rem] uppercase tracking-[0.14em] text-charcoal/55 dark:text-white/55">Sizes: {item.sizeOptions.join(' · ')}</p> : null}
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
                {shoppingBag.items.length ? shoppingBag.items.map((item) => { const lineKey = cartLineKey(item); return <div key={lineKey} className="flex gap-4 border-b border-black/10 py-5 dark:border-white/10"><div className="h-24 w-20 shrink-0 overflow-hidden rounded-[12px] bg-sand">{item.image ? <img src={item.image} alt={item.name} className="h-full w-full object-cover" /> : null}</div><div className="min-w-0 flex-1"><p className="font-display text-lg">{item.name}</p>{item.variant ? <p className="mt-1 text-[0.6rem] uppercase tracking-[0.18em] text-charcoal/50 dark:text-white/50">{item.variant.name}: {item.variant.value}</p> : null}{item.customSize ? <p className="mt-1 text-[0.6rem] uppercase tracking-[0.18em] text-charcoal/50 dark:text-white/50">Custom size · {item.customSize.unit}</p> : null}<p className="mt-2 text-xs text-charcoal/70 dark:text-white/70">Unit price: <SaleAmount amount={item.price} sale={item.sale} /></p><p className="mt-1 text-xs text-charcoal/70 dark:text-white/70">Subtotal: {formatPrice(item.price * item.quantity)}</p><ShippingTimeline timeline={cartItemShippingTimeline(item)} compact /><div className="mt-3 flex items-center gap-2"><button type="button" onClick={() => updateStoredCartQuantity(item.productId, item.quantity - 1, item.variant?.id, lineKey)} aria-label={`Decrease quantity of ${item.name}`} className="grid h-8 w-8 place-items-center border border-black/15 transition hover:text-gold dark:border-white/20"><Minus size={13} /></button><span className="min-w-6 text-center text-xs">{item.quantity}</span><button type="button" disabled={item.quantity >= 50} onClick={() => updateStoredCartQuantity(item.productId, item.quantity + 1, item.variant?.id, lineKey)} aria-label={`Increase quantity of ${item.name}`} className="grid h-8 w-8 place-items-center border border-black/15 transition hover:text-gold disabled:cursor-not-allowed disabled:opacity-35 dark:border-white/20"><Plus size={13} /></button></div><button type="button" onClick={() => removeStoredCartItem(item.productId, item.variant?.id, lineKey)} className="mt-3 text-[0.55rem] uppercase tracking-[0.2em] text-gold">Remove</button></div></div>; }) : <div className="flex min-h-full flex-col items-center justify-center gap-4 text-center"><ShoppingBag className="h-7 w-7 text-gold" strokeWidth={1.25} /><p>Your bag is empty.</p><Link href="/collections" onClick={() => setBagOpen(false)} className="border-b border-charcoal/40 pb-2 text-[0.6rem] uppercase tracking-[0.25em] dark:border-white/40">Explore Collections</Link></div>}
              </div>
              <div className="border-t border-black/10 bg-[#fffdf9] px-6 py-5 dark:border-white/10 dark:bg-[#121212]">
                {shoppingBag.items.length ? <div className="mb-4 flex items-center justify-between text-sm"><span>Subtotal</span><span>{formatPrice(getCartSubtotal(shoppingBag))}</span></div> : null}
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
