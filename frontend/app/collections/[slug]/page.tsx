import { redirect } from 'next/navigation';
import { CollectionDetailPage } from '@/components/collections/collection-detail-page';
import { collectionPages } from '@/lib/home-content';
import { pageMetadata } from '@/lib/site-metadata';

type CollectionSlugPageProps = {
  params: Promise<{
    slug: string;
  }>;
};

const collectionAliases: Record<string, string> = {
  anamika: 'collections-of-anamika',
};

export function generateStaticParams() {
  const canonicalParams = collectionPages
    .filter((collection) => collection.route !== '/collections/aakaar-insights')
    .map((collection) => ({
      slug: collection.route.replace('/collections/', ''),
    }));
  return [...canonicalParams, ...Object.keys(collectionAliases).map((slug) => ({ slug }))];
}

export async function generateMetadata({ params }: CollectionSlugPageProps) {
  const { slug } = await params;
  const canonicalSlug = collectionAliases[slug] || slug;
  const collection = collectionPages.find((item) => item.route === `/collections/${canonicalSlug}`);
  if (!collection) {
    const name = canonicalSlug.split('-').filter(Boolean).map((part) => part[0]?.toUpperCase() + part.slice(1)).join(' ');
    return pageMetadata(`${name} Collection`, `Discover the ${name} collection by Rashi Kapoor.`, `/collections/${canonicalSlug}`);
  }
  return pageMetadata(
    `${collection.name} Collection`,
    `${collection.summary} Discover the ${collection.name} collection by Rashi Kapoor.`,
    collection.route,
  );
}

export default async function CollectionSlugPage({ params }: CollectionSlugPageProps) {
  const { slug } = await params;
  if (collectionAliases[slug]) {
    redirect(`/collections/${collectionAliases[slug]}`);
  }
  const collection = collectionPages.find((item) => item.route === `/collections/${slug}`) || {
    name: slug.split('-').filter(Boolean).map((part) => part[0]?.toUpperCase() + part.slice(1)).join(' '),
    route: `/collections/${slug}`,
    status: 'Collection',
    summary: '',
    image: '',
    fontFamily: 'var(--font-display)',
  };

  return <CollectionDetailPage collection={collection} />;
}
