'use client';

import Link from 'next/link';
import { collectionDisplayName } from '@/lib/home-content';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import type { CatalogProduct } from '@/lib/catalog';
import { salePricePreview } from '@/lib/sales';
import { useCurrency } from '@/components/commerce/currency-provider';
import { saleAccess, saleApi, saleButton, saleField, type SaleCampaign, type SaleItem } from './sale-admin-client';

type CollectionOption = { id: string; name: string };
type SaleProduct = CatalogProduct & { collections?: CollectionOption[] };

export function SaleCampaignProducts() {
  const { campaignId } = useParams<{ campaignId: string }>();
  const [campaign, setCampaign] = useState<SaleCampaign | null>(null);
  const [items, setItems] = useState<SaleItem[]>([]);
  const [assignmentCatalogue, setAssignmentCatalogue] = useState<SaleProduct[]>([]);
  const [catalogue, setCatalogue] = useState<SaleProduct[]>([]);
  const [collections, setCollections] = useState<CollectionOption[]>([]);
  const [collection, setCollection] = useState('');
  const [query, setQuery] = useState('');
  const [allowed, setAllowed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const [eligibleCount, setEligibleCount] = useState(0);
  const [excluded, setExcluded] = useState<{id:string;name:string;productCode:string;adminUrl?:string;reasons:string[]}[]>([]);
  const [retryRevision, setRetryRevision] = useState(0);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [dirty, setDirty] = useState(false);
  const { formatPrice } = useCurrency();

  const loadCampaign = useCallback(async () => {
    const [data, products] = await Promise.all([saleApi('/manage'), saleApi('/products')]);
    const found = (data.campaigns as SaleCampaign[]).find(item => item.id === campaignId);
    if (!found) throw new Error('Campaign not found.');
    setCampaign(found); setItems(found.items || []); setAssignmentCatalogue(products.products || []); setDirty(false);
  }, [campaignId]);

  useEffect(() => { let active = true; void saleAccess().then(async access => { if (!active) return; setAllowed(access.allowed); if (!access.allowed) return; try { await loadCampaign(); } catch (e) { if (active) setError(String(e)); } }); return () => { active = false; }; }, [loadCampaign]);

  const loadProducts = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setLoadError(''); setCatalogue([]); setExcluded([]);
    try {
      const params = new URLSearchParams(); if (collection) params.set('collection', collection); if (query.trim()) params.set('q', query.trim());
      const result = await saleApi(`/products?${params.toString()}`, 'GET', undefined, signal);
      if (signal?.aborted) return;
      setCatalogue(result.products || []); setCollections(result.collections || []);
      setTotalCount(result.totalCount ?? result.products?.length ?? 0); setEligibleCount(result.eligibleCount ?? result.products?.length ?? 0); setExcluded(result.excludedProducts || []);
    } catch (e) { if (!signal?.aborted) setLoadError(e instanceof Error ? e.message : 'Catalogue request failed.'); }
    finally { if (!signal?.aborted) setLoading(false); }
  }, [collection, query]);

  useEffect(() => { if (!allowed) return; const controller = new AbortController(); void loadProducts(controller.signal); return () => controller.abort(); }, [allowed, loadProducts, retryRevision]);
  useEffect(() => { if (!dirty) return; const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; }; window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn); }, [dirty]);

  useEffect(()=>{const refresh=()=>{setRetryRevision(value=>value+1);void saleApi('/products').then(result=>setAssignmentCatalogue(result.products||[])).catch(()=>{});};window.addEventListener('focus',refresh);return()=>window.removeEventListener('focus',refresh);},[]);

  const byId = useMemo(() => new Map(assignmentCatalogue.map(product => [product.id, product])), [assignmentCatalogue]);
  const alreadyAssigned = (productId: string, variantId: string) => items.some(item => item.productId === productId && (!item.variantId || !variantId || item.variantId === variantId));

  function add(product: SaleProduct, variantId: string) {
    if (alreadyAssigned(product.id, variantId)) { setError('This product/variant is already assigned.'); return; }
    setItems(current => [...current, { productId: product.id, variantId, discountPercent: 10 }]); setDirty(true); setError('');
  }
  async function save() {
    if (!campaign) return; setBusy(true); setError(''); setNotice('');
    try { const result = await saleApi(`/manage/${campaign.id}`, 'PUT', { revision: campaign.revision, items }); setCampaign(result.campaign); setItems(result.campaign.items || []); setDirty(false); setNotice('Product assignments saved.'); }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to save product assignments.'); }
    finally { setBusy(false); }
  }
  function confirmNavigation(event: React.MouseEvent<HTMLAnchorElement>) { if (dirty && !confirm('You have unsaved product changes. Leave without saving?')) event.preventDefault(); }

  if (!allowed) return <section className="rounded-2xl bg-[var(--admin-surface)] p-8">Sale access requires administrator permission.</section>;
  if (!campaign) return <section className="rounded-2xl bg-[var(--admin-surface)] p-8">{error || 'Loading campaign…'}</section>;
  const availableProducts = catalogue.filter(product => {
    const variants = (product.variants || []).filter(v => v.status === 'active' && Number(v.price ?? product.price) > 0);
    if (variants.length) return variants.some(variant => !alreadyAssigned(product.id, variant.id));
    return !product.variants?.length && !alreadyAssigned(product.id, '');
  });
  return <section className="mx-auto max-w-6xl space-y-6 rounded-2xl bg-[var(--admin-surface)] p-5 sm:p-8">
    <nav className="flex flex-wrap gap-3 text-sm"><Link href="/admin/sales" onClick={confirmNavigation} className="hover:underline">← Sale Management</Link><Link href={`/admin/sales/${campaign.id}`} onClick={confirmNavigation} className="hover:underline">Overview</Link><Link href={`/admin/sales/${campaign.id}/details`} onClick={confirmNavigation} className="hover:underline">Edit Details</Link></nav>
    <header><p className="text-xs uppercase tracking-[.2em] text-red-700">Manage Products</p><h1 className="mt-2 font-display text-3xl">{campaign.title}</h1><p className="mt-2 text-sm text-[var(--admin-muted)]">Product assignments and discounts are saved independently of campaign details.</p></header>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}{notice && <p role="status" className="text-sm text-green-800">{notice}</p>}
    <section id="available-products" aria-label="Available Products" className="space-y-4 rounded-xl border border-[var(--admin-border)] p-4 sm:p-5">
      <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="font-display text-2xl">Available Products</h2><p className="mt-1 text-sm text-[var(--admin-muted)]">Choose a collection to load its eligible products. Search narrows those results.</p></div><div className="flex items-center gap-3"><span className="text-sm" aria-live="polite">{loading ? 'Loading…' : `${availableProducts.length} available results`}</span><button className={saleButton} onClick={() => document.getElementById('sale-collection-filter')?.focus()}>Add Products</button></div></div>
      {!loading && !loadError && <p className="text-sm text-[var(--admin-muted)]" aria-live="polite">{totalCount} total products | {eligibleCount} eligible products | {assignmentCatalogue.filter(product => (!collection || product.collections?.some(c => c.id === collection)) && items.some(item => item.productId === product.id)).length} already assigned products</p>}
      <div className="grid gap-3 sm:grid-cols-2"><label className="text-xs">Collection<select id="sale-collection-filter" aria-label="Collection" className={`${saleField} mt-2`} value={collection} onChange={e => { setCollection(e.target.value); setQuery(''); }}><option value="">All collections</option>{collections.map(item => <option key={item.id} value={item.id}>{collectionDisplayName(item)}</option>)}</select></label><label className="text-xs">Search products<input aria-label="Search products" className={`${saleField} mt-2`} value={query} onChange={e => setQuery(e.target.value)} placeholder="Name, code, SKU, colour or style" /></label></div>
      {loadError && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 text-sm text-red-700"><span>Catalogue request failed; retry. {loadError}</span><button className={saleButton} onClick={() => setRetryRevision(value => value + 1)}>Retry</button></div>}
      {loading ? <p role="status" className="py-5 text-sm">Loading products…</p> : !loadError && catalogue.length === 0 ? <p className="py-5 text-sm text-[var(--admin-muted)]">{query.trim() ? 'No sale-eligible products match this search.' : totalCount > 0 ? 'Products exist but none are sale-eligible.' : collection ? 'No products exist in this collection.' : 'No products are available.'}</p> : null}
      {!loading && !loadError && catalogue.length > 0 && availableProducts.length === 0 && <p className="text-sm text-[var(--admin-muted)]">All eligible products are already in this sale.</p>}
      {!loading && !loadError && excluded.length > 0 && <div className="rounded-lg border border-[var(--admin-border)] p-3"><h3 className="text-sm font-medium">Unavailable for sale ({excluded.length})</h3><ul className="mt-2 space-y-2 text-sm">{excluded.map(product => <li key={product.id}><span className="font-medium">{product.name} - {product.productCode}</span><span className="block text-[var(--admin-muted)]">{product.reasons.join('; ')}</span><span className="block break-all text-xs">Product ID: {product.id}</span>{product.adminUrl && <Link href={product.adminUrl} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block underline">Open product management</Link>}</li>)}</ul></div>}
      <div className="max-h-[32rem] space-y-3 overflow-y-auto">{availableProducts.map(product => {
        const productWide = items.some(item => item.productId === product.id && !item.variantId);
        const variants = (product.variants || []).filter(v => v.status === 'active' && Number(v.price ?? product.price) > 0);
        const image = product.media?.[0] || variants.flatMap(v => v.images || [])[0];
        return <article key={product.id} className="flex flex-col gap-3 border-b border-[var(--admin-border)] py-3 sm:flex-row sm:items-center">
          {image && <img src={image} alt="" className="h-24 w-20 shrink-0 rounded object-cover" />}
          <div className="min-w-0 flex-1"><h3 className="font-medium">{product.name}</h3><p className="text-xs text-[var(--admin-muted)]">Code: {product.productCode || product.parentSku || product.sku || '—'}</p><p className="text-xs text-[var(--admin-muted)]">Collection: {product.collections?.map(c => collectionDisplayName(c)).join(', ') || '—'}</p><p className="text-sm">Original MRP: {formatPrice(product.price)}</p>{variants.length > 0 && <div className="mt-2 flex flex-wrap gap-2">{variants.map(variant => { const assigned = alreadyAssigned(product.id, variant.id); const discount = 10; const salePrice = salePricePreview(variant.price ?? product.price, discount); return <button key={variant.id} className={`${saleButton} text-left`} disabled={assigned || productWide} onClick={() => add(product, variant.id)}>{assigned || productWide ? 'Added' : 'Add'} {variant.colour || 'Variant'} · {variant.sku} · {formatPrice(variant.price ?? product.price)}{salePrice !== null ? ` → ${formatPrice(salePrice)}` : ''}</button>; })}{!items.some(item => item.productId === product.id) && <button className={saleButton} onClick={() => add(product, '')}>Add all eligible variants</button>}</div>}{!variants.length && !product.variants?.length && <button className={`${saleButton} mt-2`} disabled={alreadyAssigned(product.id, '')} onClick={() => add(product, '')}>{alreadyAssigned(product.id, '') ? 'Added' : 'Add product'}</button>}</div>
        </article>;
      })}</div>
    </section>
    <section aria-label="Products in This Sale" className="space-y-4 rounded-xl border border-[var(--admin-border)] p-4 sm:p-5"><div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="font-display text-2xl">Products in This Sale</h2><p className="mt-1 text-sm text-[var(--admin-muted)]">Each assignment keeps its original MRP; sale price is calculated from its discount.</p></div><span className="text-sm">{items.length} assignments</span></div>
      {items.length ? <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead><tr>{['Product / Code / Collection','Colour / SKU','Original MRP','Discount %','Sale price','Remove'].map(h=><th key={h} className="border-b p-2">{h}</th>)}</tr></thead><tbody>{items.map((item,index)=>{ const product=byId.get(item.productId); const variant=product?.variants?.find(v=>v.id===item.variantId); const mrp=variant?.price??product?.price; return <tr key={`${item.productId}:${item.variantId}`}><td className="border-b p-2">{product?.media?.[0] && <img src={product.media[0]} alt="" className="mr-2 inline h-12 w-9 object-cover"/>}{product?.name||item.productId}<p className="text-xs">{product?.productCode||product?.parentSku||product?.sku}</p><p className="text-xs">{product?.collections?.map(c=>c.name).join(', ')}</p></td><td className="border-b p-2">{variant ? `${variant.colour} · ${variant.sku}` : 'All eligible variants'}</td><td className="border-b p-2"><del>{formatPrice(mrp)}</del></td><td className="border-b p-2"><input aria-label={`Discount for item ${index+1}`} type="number" min="0.01" max="99.99" step="0.01" className={`${saleField} !w-24 text-red-700`} value={item.discountPercent} onChange={e=>{ setItems(current=>current.map((entry,i)=>i===index?{...entry,discountPercent:Number(e.target.value)}:entry)); setDirty(true); }}/></td><td className="border-b p-2">{salePricePreview(mrp,item.discountPercent)!==null?formatPrice(salePricePreview(mrp,item.discountPercent)!):'Invalid discount'}</td><td className="border-b p-2"><button className="text-red-700" onClick={()=>{setItems(current=>current.filter((_,i)=>i!==index));setDirty(true);}}>Remove</button></td></tr>;})}</tbody></table></div> : <p className="py-5 text-sm text-[var(--admin-muted)]">No products assigned yet.</p>}
      <button className={saleButton} disabled={busy || !dirty} onClick={() => void save()}>Save Product Changes</button>
    </section>
  </section>;
}
