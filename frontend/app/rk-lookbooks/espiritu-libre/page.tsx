import { LookbookIntro } from '@/components/lookbook-intro';
import { pageMetadata } from '@/lib/site-metadata';

export const metadata = pageMetadata('Espiritu Libre Lookbook', 'Enter the Espiritu Libre lookbook by Rashi Kapoor, an editorial story of movement and liberated silhouettes.', '/rk-lookbooks/espiritu-libre', { index: false });

export default function EspirituLibreLookbookPage() {
  return <LookbookIntro name="Espiritu Libre" number="05" description="An expressive runway chapter shaped by liberated movement, fluid drape, and the confidence of modern Indian couture." url="https://lookbookmaker.onrender.com/catalog/espi?page=1" />;
}
