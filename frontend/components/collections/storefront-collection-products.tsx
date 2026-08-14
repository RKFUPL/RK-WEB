'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { SlidersHorizontal, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { CollectionProductCard } from '@/components/collections/collection-product-card';
import type { CatalogProduct, ManagedCollection, ProductAvailability } from '@/lib/catalog';

type SortOption = 'featured' | 'newest' | 'price_asc' | 'price_desc';

const selectClass = 'w-full border-b border-black/15 bg-transparent py-3 text-xs text-charcoal outline-none focus:border-gold dark:border-white/20';

function unique(values: Array<string | undefined>) {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))].sort();
}

export function StorefrontCollectionProducts({ collection, loading = false }: {
  collection: (ManagedCollection & { products: CatalogProduct[] }) | null;
  loading?: boolean;
}) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [category, setCategory] = useState('');
  const [size, setSize] = useState('');
  const [color, setColor] = useState('');
  const [availability, setAvailability] = useState<ProductAvailability | ''>('');
  const [maxPrice, setMaxPrice] = useState('');
  const [sort, setSort] = useState<SortOption>('featured');
  const products = useMemo(() => collection?.products ?? [], [collection]);
  const categories = useMemo(() => unique(products.map((product) => product.category || 'Couture')), [products]);
  const sizes = useMemo(() => unique(products.flatMap((product) => product.attributes?.sizes ?? [])), [products]);
  const colors = useMemo(() => unique(products.flatMap((product) => product.attributes?.colors ?? (product.attributes?.color ? [String(product.attributes.color)] : []))), [products]);
  const activeFilterCount = [category, size, color, availability, maxPrice].filter(Boolean).length;

  const visibleProducts = useMemo(() => {
    const maximum = maxPrice ? Number(maxPrice) : null;
    const filtered = products.filter((product) => {
      if (category && (product.category || 'Couture') !== category) return false;
      if (size && !(product.attributes?.sizes ?? []).includes(size)) return false;
      const productColors = product.attributes?.colors ?? (product.attributes?.color ? [String(product.attributes.color)] : []);
      if (color && !productColors.includes(color)) return false;
      if (availability && product.availability !== availability) return false;
      if (maximum !== null && Number(product.price ?? 0) > maximum) return false;
      return true;
    });
    return [...filtered].sort((left, right) => {
      if (sort === 'price_asc') return Number(left.price ?? Number.MAX_SAFE_INTEGER) - Number(right.price ?? Number.MAX_SAFE_INTEGER);
      if (sort === 'price_desc') return Number(right.price ?? 0) - Number(left.price ?? 0);
      if (sort === 'newest') return new Date(right.createdAt ?? 0).getTime() - new Date(left.createdAt ?? 0).getTime();
      return Number(left.displayOrder ?? 0) - Number(right.displayOrder ?? 0);
    });
  }, [availability, category, color, maxPrice, products, size, sort]);

  const resetFilters = () => { setCategory(''); setSize(''); setColor(''); setAvailability(''); setMaxPrice(''); };

  return <section id="collection-products" className="scroll-mt-20 border-t border-black/10 bg-ivory px-4 pb-20 pt-12 text-charcoal dark:border-white/10 sm:px-8 sm:pb-20 sm:pt-14 lg:px-12 lg:pb-24 lg:pt-16">
    <div className="mx-auto max-w-[100rem]">
      <div className="flex flex-col justify-between gap-8 border-b border-black/12 pb-7 dark:border-white/15 md:flex-row md:items-end">
        <div>
          <p className="text-[0.58rem] uppercase tracking-[0.38em] text-gold">The collection</p>
          <h2 className="mt-3 font-display text-4xl leading-none sm:text-5xl">{collection?.name || 'Collection'}</h2>
          <p className="mt-3 text-[0.58rem] uppercase tracking-[0.3em] text-charcoal/48">{products.length} {products.length === 1 ? 'piece' : 'pieces'}</p>
        </div>
        <div className="flex items-center gap-6 md:justify-end">
          <button type="button" onClick={() => setFiltersOpen((current) => !current)} className="inline-flex items-center gap-2 text-[0.6rem] uppercase tracking-[0.27em] transition hover:text-gold"><SlidersHorizontal size={14} strokeWidth={1.4} />Filter{activeFilterCount ? ` (${activeFilterCount})` : ''}</button>
          <label className="flex items-center gap-3 text-[0.6rem] uppercase tracking-[0.27em] text-charcoal/55">Sort by<select value={sort} onChange={(event) => setSort(event.target.value as SortOption)} className="border-0 bg-transparent py-2 text-[0.64rem] normal-case tracking-normal text-charcoal outline-none"><option value="featured">Featured</option><option value="newest">Newest</option><option value="price_asc">Price Low → High</option><option value="price_desc">Price High → Low</option></select></label>
        </div>
      </div>

      <AnimatePresence initial={false}>{filtersOpen ? <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }} className="overflow-hidden"><div className="grid gap-x-7 gap-y-4 border-b border-black/10 py-7 dark:border-white/10 sm:grid-cols-2 lg:grid-cols-5">
        <label className="text-[0.55rem] uppercase tracking-[0.25em] text-charcoal/45">Category<select value={category} onChange={(event) => setCategory(event.target.value)} className={selectClass}><option value="">All categories</option>{categories.map((value) => <option key={value}>{value}</option>)}</select></label>
        <label className="text-[0.55rem] uppercase tracking-[0.25em] text-charcoal/45">Size<select value={size} onChange={(event) => setSize(event.target.value)} className={selectClass}><option value="">All sizes</option>{sizes.map((value) => <option key={value}>{value}</option>)}</select></label>
        <label className="text-[0.55rem] uppercase tracking-[0.25em] text-charcoal/45">Color<select value={color} onChange={(event) => setColor(event.target.value)} className={selectClass}><option value="">All colors</option>{colors.map((value) => <option key={value}>{value}</option>)}</select></label>
        <label className="text-[0.55rem] uppercase tracking-[0.25em] text-charcoal/45">Availability<select value={availability} onChange={(event) => setAvailability(event.target.value as ProductAvailability | '')} className={selectClass}><option value="">All availability</option><option value="in_stock">In Stock</option><option value="custom_order">Custom Order</option><option value="sold_out">Sold Out</option></select></label>
        <label className="text-[0.55rem] uppercase tracking-[0.25em] text-charcoal/45">Maximum price<input type="number" min={0} value={maxPrice} onChange={(event) => setMaxPrice(event.target.value)} placeholder="No maximum" className={selectClass} /></label>
        {activeFilterCount ? <button type="button" onClick={resetFilters} className="inline-flex items-center gap-2 justify-self-start text-[0.56rem] uppercase tracking-[0.24em] text-gold lg:col-span-5"><X size={13} />Clear filters</button> : null}
      </div></motion.div> : null}</AnimatePresence>

      {loading ? <div className="mt-9 grid grid-cols-2 gap-x-3 gap-y-10 md:grid-cols-3 md:gap-x-6 lg:grid-cols-4">{Array.from({ length: 4 }, (_, index) => <div key={index} className="animate-pulse"><div className="aspect-[3/4] bg-sand" /><div className="mt-4 h-3 w-1/3 bg-sand" /><div className="mt-3 h-5 w-3/4 bg-sand" /></div>)}</div> : visibleProducts.length ? <motion.div initial="hidden" whileInView="visible" viewport={{ once: true, amount: 0.08 }} variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.07 } } }} className="mt-9 grid grid-cols-2 gap-x-3 gap-y-10 md:grid-cols-3 md:gap-x-6 md:gap-y-14 lg:grid-cols-4 lg:gap-x-7">
        {visibleProducts.map((product) => <motion.div key={product.id} variants={{ hidden: { opacity: 0, y: 18 }, visible: { opacity: 1, y: 0, transition: { duration: 0.55, ease: [0.22, 1, 0.36, 1] } } }}><CollectionProductCard product={product} /></motion.div>)}
      </motion.div> : <div className="mt-12 border border-black/10 px-6 py-16 text-center dark:border-white/10"><p className="font-display text-2xl">{products.length ? 'No pieces match these filters.' : 'No products in this collection yet.'}</p>{activeFilterCount ? <button type="button" onClick={resetFilters} className="mt-5 text-[0.6rem] uppercase tracking-[0.25em] text-gold">Clear filters</button> : null}</div>}
    </div>
  </section>;
}
