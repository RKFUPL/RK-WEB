import { Footer } from '@/components/home/footer';
import { StickyHeader } from '@/components/home/sticky-header';
import { RunwayHero } from '@/components/runway-hero';
import { runwayCollections } from '@/lib/home-content';
import { pageMetadata } from '@/lib/site-metadata';

export const metadata = pageMetadata('Runway', 'Discover the Rashi Kapoor runway archive, beginning with Espiritu Libre.', '/runway');

export default function RunwayPage() {
  const primaryCollection = runwayCollections[0];

  return (
    <main className="min-h-screen bg-black text-white">
      <StickyHeader transparentAtTop transparentTheme="light" />
      {primaryCollection ? <RunwayHero title={primaryCollection.name} /> : null}
      <Footer />
    </main>
  );
}
