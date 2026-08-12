import { LaunchPage } from '@/components/launch-page';
import { pageMetadata } from '@/lib/site-metadata';

export const metadata = pageMetadata(
  'Luxury Indian Womenswear & Couture',
  'Explore Rashi Kapoor couture collections, campaign imagery, editorial films, and lookbooks shaped by Indian craft.',
  '/',
);

export default function HomePage() {
  return <LaunchPage />;
}
