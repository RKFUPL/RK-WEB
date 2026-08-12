import { LookbookIntro } from '@/components/lookbook-intro';
import { pageMetadata } from '@/lib/site-metadata';

export const metadata = pageMetadata('Sandook Lookbook', 'Enter the Sandook editorial lookbook by Rashi Kapoor, a treasured visual archive of considered occasion dressing.', '/rk-lookbooks/sandook', { index: false });

export default function SandookLookbookPage() {
  return <LookbookIntro name="SANDOOK" number="04" description="A treasured visual archive of soft occasion dressing, heirloom moods, and stories designed to be carried forward." url="https://heyzine.com/flip-book/8ce8114123.html" />;
}
