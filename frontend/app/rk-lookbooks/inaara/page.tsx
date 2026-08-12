import { LookbookIntro } from '@/components/lookbook-intro';
import { pageMetadata } from '@/lib/site-metadata';

export const metadata = pageMetadata('Inaara Lookbook', 'Enter the Inaara editorial lookbook by Rashi Kapoor, a luminous chapter of fluid lines and celebratory dressing.', '/rk-lookbooks/inaara', { index: false });

export default function InaaraLookbookPage() {
  return <LookbookIntro name="INAARA" number="06" description="A luminous celebration of floral colour, fluid lines, and couture pieces created for moments of radiance." url="https://heyzine.com/flip-book/96199b2b7e.html" />;
}
