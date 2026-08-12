import { CollectionDetailPage } from '@/components/collections/collection-detail-page';
import { collectionPages } from '@/lib/home-content';
import { pageMetadata } from '@/lib/site-metadata';

export const metadata = pageMetadata(
  'Aakaar Collection',
  'Discover Aakaar by Rashi Kapoor, a debut couture collection defined by sculpted drapes and quiet detailing.',
  '/collections/aakaar-insights',
);

export default function AakaarInsightsPage() {
  return <CollectionDetailPage collection={collectionPages[0]} />;
}
