'use client';

import { useEffect, useRef, useState } from 'react';
import { Download, ImagePlus, Loader2, Sparkles, X } from 'lucide-react';
import type { CatalogProduct } from '@/lib/catalog';
import { apiBaseUrl } from '@/lib/rbac';

export function AiTryon({ product, variantId, productImage }: { product: CatalogProduct; variantId?: string; productImage: string }) {
  const [availability, setAvailability] = useState<'loading' | 'available' | 'unavailable' | 'error'>(product.aiTryonEnabled ? 'loading' : 'unavailable');
  const [availabilityMessage, setAvailabilityMessage] = useState(product.aiTryonEnabled ? '' : 'AI Try-On is not enabled for this piece yet.');
  const [open, setOpen] = useState(false);
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [result, setResult] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!product.aiTryonEnabled) {
      setAvailability('unavailable');
      setAvailabilityMessage('AI Try-On is not enabled for this piece yet.');
      return;
    }
    if (!productImage) {
      setAvailability('unavailable');
      setAvailabilityMessage('AI Try-On is unavailable because this piece does not have a usable catalog image.');
      return;
    }
    setAvailability('loading');
    fetch(`${apiBaseUrl}/api/ai-tryon/config`, { cache: 'no-store' }).then(async (response) => {
      if (!response.ok) throw new Error('The Try-On service status could not be loaded.');
      const payload = await response.json();
      if (!payload.enabled) {
        setAvailability('unavailable');
        setAvailabilityMessage('AI Try-On is currently unavailable. The store deployment or global setting is disabled.');
        return;
      }
      const signedIn = Boolean(window.localStorage.getItem('rk_access_token'));
      if (signedIn ? payload.allowLoggedIn !== true : payload.allowGuests !== true) {
        setAvailability('unavailable');
        setAvailabilityMessage(signedIn ? 'AI Try-On is not available for signed-in customers right now.' : 'Please sign in to use AI Try-On.');
        return;
      }
      setAvailability('available');
      setAvailabilityMessage('');
    }).catch((requestError) => {
      setAvailability('error');
      setAvailabilityMessage(requestError instanceof Error ? requestError.message : 'The Try-On service status could not be loaded.');
    });
  }, [product.aiTryonEnabled, productImage]);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  if (availability !== 'available') return <p role={availability === 'error' ? 'alert' : undefined} className="mt-4 border border-black/10 bg-sand/30 px-4 py-3 text-xs leading-5 text-charcoal/65">{availability === 'loading' ? 'Checking AI Try-On availability…' : availabilityMessage}</p>;
  const choose = (file?: File) => {
    setError(''); setResult('');
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { setError('Please choose a JPEG, PNG, or WebP photo.'); return; }
    setPhoto(file); setPreview(URL.createObjectURL(file));
  };
  const generate = async () => {
    if (!photo || !accepted) { setError('Upload a photo and accept the privacy notice to continue.'); return; }
    setBusy(true); setError('');
    try {
      const form = new FormData(); form.append('photo', photo); form.append('productId', product.id); if (variantId) form.append('variantId', variantId); if (productImage) form.append('imageRef', productImage);
      const response = await fetch(`${apiBaseUrl}/api/ai-tryon/generate`, { method: 'POST', body: form, credentials: 'include' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'We could not create the preview.');
      setResult(`${apiBaseUrl}${payload.generation.imageUrl}`);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'We could not create the preview.'); }
    finally { setBusy(false); }
  };
  return <>
    <button type="button" onClick={() => { setOpen(true); setError(''); }} className="mt-4 inline-flex w-full items-center justify-center gap-2 border border-gold px-5 py-3.5 text-[0.62rem] uppercase tracking-[0.26em] text-gold transition hover:bg-gold hover:text-ink"><Sparkles size={16} /> AI Try-On</button>
    {open ? <div role="dialog" aria-modal="true" aria-label="AI Try-On" className="fixed inset-0 z-50 grid place-items-center bg-ink/70 p-4 backdrop-blur-sm"><div className="relative max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-ivory p-6 text-charcoal shadow-2xl sm:p-8"><button type="button" onClick={() => setOpen(false)} aria-label="Close AI Try-On" className="absolute right-4 top-4 p-2"><X size={20} /></button><p className="text-[0.6rem] uppercase tracking-[0.28em] text-gold">Rashi Kapoor Official</p><h2 className="mt-3 font-display text-3xl">See the piece on you</h2><p className="mt-3 max-w-xl text-sm leading-6 text-charcoal/65">A considered visual preview using your photograph and this catalog image. It is not an exact fit, sizing, or measurement guarantee.</p>
      {!result ? <><div className="mt-7 grid gap-4 sm:grid-cols-2"><button type="button" onClick={() => inputRef.current?.click()} className="relative grid min-h-64 place-items-center overflow-hidden rounded-xl border border-dashed border-charcoal/20 bg-sand/40 p-5 text-center">{preview ? <img src={preview} alt="Your uploaded photo preview" className="absolute inset-0 h-full w-full object-contain" /> : <span><ImagePlus className="mx-auto text-gold" size={28} /><span className="mt-3 block text-sm">Upload your photo</span><span className="mt-2 block text-xs text-charcoal/55">JPEG, PNG or WebP · up to 10 MB</span></span>}<input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(event) => choose(event.target.files?.[0])} /></button><div className="relative grid min-h-64 place-items-center overflow-hidden rounded-xl bg-sand"><img src={productImage} alt={product.name || 'Selected product'} className="h-full w-full object-contain" /><span className="absolute bottom-3 left-3 bg-ivory/90 px-2 py-1 text-[0.55rem] uppercase tracking-[0.18em]">Selected piece</span></div></div><label className="mt-6 flex items-start gap-3 text-xs leading-5 text-charcoal/65"><input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} className="mt-1 accent-[#9a7a4d]" />I understand that my photo will be processed by Google Gemini to create this preview and will be stored privately only for the configured retention period.</label>{error ? <p role="alert" className="mt-4 text-sm text-red-700">{error}</p> : null}<button type="button" onClick={() => void generate()} disabled={busy} className="mt-6 inline-flex w-full items-center justify-center gap-2 bg-ink px-5 py-4 text-[0.62rem] uppercase tracking-[0.26em] text-ivory disabled:opacity-50">{busy ? <><Loader2 size={16} className="animate-spin" /> Creating preview...</> : <><Sparkles size={16} /> Generate Try-On</>}</button></> : <div className="mt-7"><img src={result} alt="AI Try-On result" className="mx-auto max-h-[60vh] rounded-xl object-contain" /><p className="mt-4 text-center text-xs text-charcoal/55">AI-generated visual preview. Garment appearance and fit may differ from the physical piece.</p><div className="mt-5 flex flex-wrap justify-center gap-3"><a href={result} download={`rk-try-on-${product.slug || product.id}.png`} className="inline-flex items-center gap-2 border border-charcoal/20 px-4 py-3 text-xs uppercase tracking-[0.18em]"><Download size={15} /> Download</a><button type="button" onClick={() => { setResult(''); setPhoto(null); setPreview(''); setAccepted(false); }} className="bg-ink px-4 py-3 text-xs uppercase tracking-[0.18em] text-ivory">Try another photo</button></div></div>}
    </div></div> : null}
  </>;
}
