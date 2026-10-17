'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { createPortal } from 'react-dom';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useCurrency } from '@/components/commerce/currency-provider';
import { apiBaseUrl } from '@/lib/rbac';

const codes = ['USD', 'EUR', 'AED', 'GBP'] as const;
type PopoverPosition = { right: number; top: number };

export function ForexTicker({ mobile = false }: { mobile?: boolean }) {
  const { rates, rateStatus, ratesAsOf, rateSource, rateType } = useCurrency();
  const [enabled, setEnabled] = useState(false);
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [position, setPosition] = useState<PopoverPosition>({ right: 16, top: 72 });
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const available = codes.every((code) => Number(rates[code]) > 0);
  const updated = ratesAsOf ? new Date(ratesAsOf) : null;
  const updatedLabel = updated && !Number.isNaN(updated.valueOf()) ? updated.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : ratesAsOf;

  const cancelClose = useCallback(() => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  }, []);

  const close = useCallback(() => {
    cancelClose();
    setPinned(false);
    setOpen(false);
  }, [cancelClose]);

  const scheduleHoverClose = useCallback(() => {
    cancelClose();
    closeTimerRef.current = setTimeout(() => {
      if (!pinned) setOpen(false);
    }, 180);
  }, [cancelClose, pinned]);

  const updatePosition = useCallback(() => {
    if (mobile || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    setPosition({ right: Math.max(16, window.innerWidth - rect.right), top: rect.bottom + 12 });
  }, [mobile]);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`${apiBaseUrl}/api/storefront-settings`, { cache: 'no-store', signal: controller.signal })
      .then(async (response) => response.ok ? response.json() : Promise.reject(new Error('Unable to load storefront settings.')))
      .then((payload) => setEnabled(payload?.settings?.showStorefrontForex === true))
      .catch((error) => { if (error instanceof Error && error.name !== 'AbortError') setEnabled(false); });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    updatePosition();
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !panelRef.current?.contains(target)) close();
    };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [close, open, updatePosition]);

  useEffect(() => () => cancelClose(), [cancelClose]);
  if (!enabled) return null;

  const statusLabel = rateStatus === 'live' ? 'Current reference' : rateStatus === 'stale' ? 'Stale reference' : rateStatus === 'configured_fallback' ? 'Fallback reference' : 'Rates unavailable';
  const panel = <AnimatePresence>
    {open ? <motion.section ref={panelRef} role="dialog" aria-label="Foreign exchange reference rates" initial={{ opacity: 0, y: 7 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 7 }} onMouseEnter={cancelClose} onMouseLeave={scheduleHoverClose} className={mobile ? 'mt-2 w-full border border-black/10 bg-ivory p-5 text-charcoal shadow-lg' : 'fixed z-[500] w-[min(20rem,calc(100vw-2rem))] border border-black/10 bg-white p-5 text-charcoal shadow-[0_18px_45px_rgba(18,18,18,0.16)]'} style={mobile ? undefined : position}>
      <div className="flex items-center justify-between gap-4"><p className="text-[0.6rem] uppercase tracking-[0.24em] text-gold">INR reference rates</p><span className="text-[0.55rem] uppercase tracking-[0.14em] text-charcoal/45">{statusLabel}</span></div>
      {available ? <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3">{codes.map((code) => <div key={code} className="flex items-baseline justify-between gap-3 border-b border-black/8 pb-2"><dt className="text-[0.62rem] tracking-[0.16em]">{code}</dt><dd className="font-serif text-base">{Number(rates[code]).toFixed(code === 'AED' ? 4 : 5)}</dd></div>)}</dl> : <p className="mt-4 text-xs leading-5 text-charcoal/60">Latest rates are temporarily unavailable.</p>}
      <p className="mt-4 text-[0.65rem] leading-5 text-charcoal/55">1 INR equals the amount shown. {rateType || 'Daily indicative reference rates'}; not intraday trading rates.</p>
      {rateSource ? <p className="mt-2 text-[0.6rem] leading-5 text-charcoal/45">Source: {rateSource}{updatedLabel ? ` · Updated ${updatedLabel}` : ''}</p> : null}
    </motion.section> : null}
  </AnimatePresence>;

  return <div ref={rootRef} className={`relative ${mobile ? 'w-full' : ''}`} onMouseEnter={() => { if (!mobile) { cancelClose(); updatePosition(); setOpen(true); } }} onMouseLeave={() => { if (!mobile) scheduleHoverClose(); }}>
    <button ref={buttonRef} type="button" aria-label="Foreign exchange reference rates" aria-haspopup="dialog" aria-expanded={open} onClick={(event) => { event.stopPropagation(); cancelClose(); if (open && pinned) close(); else { updatePosition(); setPinned(true); setOpen(true); } }} className={mobile ? 'flex w-full items-center border-b border-black/10 bg-white px-1 py-4 text-left text-xs uppercase tracking-[0.3em] text-charcoal/60 transition hover:border-gold hover:text-gold' : 'border-0 bg-transparent p-0 text-[0.58rem] font-medium uppercase tracking-[0.18em] text-current transition hover:text-gold focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-4 focus-visible:outline-gold'}>
      FX
    </button>
    {mobile ? panel : typeof document !== 'undefined' ? createPortal(panel, document.body) : null}
  </div>;
}
