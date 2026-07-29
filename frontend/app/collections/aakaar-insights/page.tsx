import { CollectionDetailPage } from '@/components/collections/collection-detail-page';
import { collectionPages } from '@/lib/home-content';

export default function AakaarInsightsPage() {
  return <CollectionDetailPage collection={collectionPages[0]} />;
}
