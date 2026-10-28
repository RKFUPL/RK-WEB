import { ChevronRight, Image as ImageIcon } from 'lucide-react';
import Link from 'next/link';
import type { ManagedCollection } from '@/lib/catalog';

export const collectionManagementCardImage = (collection: ManagedCollection) =>
  collection.coverImage || collection.heroImage || collection.hero?.image || '';

export function CollectionManagementCard({ collection, href, statusLabel, createdLabel }: {
  collection: ManagedCollection;
  href: string;
  statusLabel?: string;
  createdLabel?: string;
}) {
  const image = collectionManagementCardImage(collection);
  return <Link href={href} aria-label={`Open ${collection.name} collection`} className="group overflow-hidden rounded-xl border border-black/[.08] bg-[#fffdf9] text-left transition hover:-translate-y-0.5 hover:border-[#9a7a4d]/50 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9a7a4d]/45 dark:border-white/[.08] dark:bg-white/[.02]">
    <div className="relative aspect-[16/9] overflow-hidden bg-[#eee8de] dark:bg-white/[.04]">
      {image ? <img src={image} alt={`${collection.name} collection cover`} loading="lazy" decoding="async" className="h-full w-full object-cover object-center transition duration-300 group-hover:scale-[1.03]" /> : <div className="grid h-full place-items-center text-[#9a7a4d]"><span className="text-center"><ImageIcon className="mx-auto h-6 w-6" strokeWidth={1.25} /><span className="mt-2 block text-[10px] uppercase tracking-[.2em]">Collection image unavailable</span></span></div>}
    </div>
    <div className="flex min-h-36 items-start justify-between gap-4 p-5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2"><h3 className="truncate text-lg font-medium">{collection.name}</h3>{statusLabel ? <span className="rounded-full border border-black/[.08] px-2 py-1 text-[9px] uppercase tracking-[.13em] text-[#7d756d] dark:border-white/10">{statusLabel}</span> : null}</div>
        <p className="mt-1 truncate text-[10px] uppercase tracking-[.16em] text-[#8a9098]">{collection.collectionNumber || collection.slug}</p>
        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#6e747d]"><span>{collection.productCount} {collection.productCount === 1 ? 'product' : 'products'}</span>{createdLabel ? <span>Created {createdLabel}</span> : null}</div>
      </div>
      <ChevronRight size={18} className="mt-1 shrink-0 text-[#9a7a4d] transition-transform group-hover:translate-x-1" />
    </div>
  </Link>;
}
