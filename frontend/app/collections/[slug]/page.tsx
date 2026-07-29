import { notFound } from 'next/navigation';
import { CollectionDetailPage } from '@/components/collections/collection-detail-page';
import { collectionPages } from '@/lib/home-content';

type CollectionSlugPageProps = {
  params: {
    slug: string;
  };
};

export function generateStaticParams() {
  return collectionPages
    .filter((collection) => collection.route !== '/collections/aakaar-insights')
    .map((collection) => ({
      slug: collection.route.replace('/collections/', ''),
    }));
}

export default function CollectionSlugPage({ params }: CollectionSlugPageProps) {
  const collection = collectionPages.find(
    (item) => item.route === `/collections/${params.slug}`
  );

  if (!collection) {
    notFound();
  }

  return <CollectionDetailPage collection={collection} />;
}
