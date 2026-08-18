import type { ReactNode } from 'react';
import { pageMetadata } from '@/lib/site-metadata';

export const metadata = pageMetadata(
  'Couture Collections',
  'Explore Rashi Kapoor collections including Aakaar, Hastakala, Inaara, Anamika, Naqab, and Sandook.',
  '/collections',
);

export default function CollectionsLayout({ children }: { children: ReactNode }) {
  return children;
}
