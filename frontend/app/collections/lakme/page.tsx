import { RunwayCollectionPage } from '@/components/runway-collection-page';
import { pageMetadata } from '@/lib/site-metadata';

export const metadata = pageMetadata('Lakme Collection', 'Explore the six-piece Rashi Kapoor Lakme runway collection.', '/collections/lakme');

export default function LakmeCollectionPage() {
  return (
    <RunwayCollectionPage
      apiPath="/api/catalog/collections/lakme"
      eyebrow="The collection"
      heading="Lakme"
      routeBase="/collections/lakme"
      paginate={false}
    />
  );
}
