import { notFound } from 'next/navigation';
import { CollectionDetailPage } from '@/components/collections/collection-detail-page';
import { collectionPages } from '@/lib/home-content';
import { pageMetadata } from '@/lib/site-metadata';

type CollectionSlugPageProps = {
  params: Promise<{
    slug: string;
  }>;
};

export function generateStaticParams() {
  return collectionPages
    .filter((collection) => collection.route !== '/collections/aakaar-insights')
    .map((collection) => ({
      slug: collection.route.replace('/collections/', ''),
    }));
}

export async function generateMetadata({ params }: CollectionSlugPageProps) {
  const { slug } = await params;
  const collection = collectionPages.find((item) => item.route === `/collections/${slug}`);
  if (!collection) return {};
  return pageMetadata(
    `${collection.name} Collection`,
    `${collection.summary} Discover the ${collection.name} collection by Rashi Kapoor.`,
    collection.route,
  );
}

export default async function CollectionSlugPage({ params }: CollectionSlugPageProps) {
  const { slug } = await params;
  const collection = collectionPages.find((item) => item.route === `/collections/${slug}`);

  if (!collection) {
    notFound();
  }

  return <CollectionDetailPage collection={collection} />;
}
