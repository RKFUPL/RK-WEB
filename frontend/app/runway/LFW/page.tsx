import { RunwayCollectionPage } from '@/components/runway-collection-page';
import { pageMetadata } from '@/lib/site-metadata';

export const metadata = pageMetadata('Lakme Runway Collection', 'Explore the Rashi Kapoor Lakme runway collection.', '/runway/LFW');

export default async function RunwayLfwPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const params = await searchParams;
  const parsedPage = Number.parseInt(params.page || '1', 10);
  return <RunwayCollectionPage initialPage={Number.isFinite(parsedPage) ? Math.max(1, parsedPage) : 1} />;
}
