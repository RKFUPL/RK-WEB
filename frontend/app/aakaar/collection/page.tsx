import { Suspense } from 'react';
import { AakaarCollectionPage } from '@/components/aakaar-collection-page';
import { pageMetadata } from '@/lib/site-metadata';

export const metadata = pageMetadata(
  'Aakaar Collection',
  'Explore the complete Indian Collection from Rashi Kapoor.',
  '/aakaar/collection',
);

function CollectionLoading() {
  return <main className="min-h-screen bg-ivory" aria-label="Loading AAKAAR collection" />;
}

export default function AakaarCollectionRoute() {
  return <Suspense fallback={<CollectionLoading />}><AakaarCollectionPage /></Suspense>;
}
