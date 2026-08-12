import type { ReactNode } from 'react';
import { pageMetadata } from '@/lib/site-metadata';

export const metadata = pageMetadata(
  'Editorial Lookbooks',
  'Browse the Rashi Kapoor editorial archive, including Anamika, Hastakala, Sandook, Espiritu Libre, and Inaara.',
  '/rk-lookbooks',
);

export default function LookbooksLayout({ children }: { children: ReactNode }) {
  return children;
}
