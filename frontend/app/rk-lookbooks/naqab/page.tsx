import { EditorialPage } from '@/components/site/editorial-page';
import { collectionPages } from '@/lib/home-content';
import { pageMetadata } from '@/lib/site-metadata';

export const metadata = pageMetadata('Naqab Lookbook', 'Enter the Naqab editorial lookbook by Rashi Kapoor, a cinematic study of layered silhouettes and evening presence.', '/rk-lookbooks/naqab', { index: false });

export default function NaqabLookbookPage() {
  const collection = collectionPages.find((item) => item.name === 'Naqab');

  return <EditorialPage
    eyebrow="RK Lookbook / 05"
    title="Naqab"
    intro="A veiled editorial chapter exploring concealment, reveal, and the quiet drama of modern occasion dressing."
    sections={[
      {
        eyebrow: 'The visual story',
        title: 'Layers in motion.',
        body: 'Naqab is shaped through translucent layers, deliberate proportion, and silhouettes that shift between softness and structure.',
        image: collection?.image,
        imageAlt: 'Naqab collection editorial',
      },
    ]}
    closing="A study in presence, revealed one layer at a time."
  />;
}
