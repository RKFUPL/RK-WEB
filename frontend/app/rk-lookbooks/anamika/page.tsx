import { LookbookIntro } from '@/components/lookbook-intro';
import { pageMetadata } from '@/lib/site-metadata';

export const metadata = pageMetadata('Anamika Lookbook', 'Enter the Anamika editorial lookbook by Rashi Kapoor, a visual chapter shaped by movement and texture.', '/rk-lookbooks/anamika', { index: false });

export default function AnamikaLookbookPage() {
  return <LookbookIntro name="Anamika" number="02" description="A movement-led editorial chapter balancing deep tones, sculpted silhouettes, and a quiet sense of theatre." url="https://heyzine.com/flip-book/da7e8ae2ad.html" />;
}
