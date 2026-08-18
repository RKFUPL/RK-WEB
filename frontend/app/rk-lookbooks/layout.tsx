import type { ReactNode } from 'react';
import { pageMetadata } from '@/lib/site-metadata';

export const metadata = pageMetadata(
  'Editorial Lookbooks',
  'Browse the Rashi Kapoor editorial archive, including Aakaar, Hastakala, Inaara, Anamika, Naqab, and Sandook.',
  '/rk-lookbooks',
);

export default function LookbooksLayout({ children }: { children: ReactNode }) {
  return children;
}
