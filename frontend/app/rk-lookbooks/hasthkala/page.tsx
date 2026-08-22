import { LookbookIntro } from '@/components/lookbook-intro';
import { pageMetadata } from '@/lib/site-metadata';

export const metadata = pageMetadata('Hastakala Lookbook', 'Enter the Hastakala editorial lookbook by Rashi Kapoor, celebrating hand-finished craft and heirloom detail.', '/rk-lookbooks/hasthkala', { index: false });

export default function HastakalaLookbookPage() {
  return <LookbookIntro name="Hastakala" number="01" description="A craft-led wedding edit where hand-finished surfaces, precise detail, and heirloom references take centre stage." url="https://lookbookmaker.onrender.com/catalog/hastakala" />;
}
