import type { ReactNode } from 'react';
import { pageMetadata } from '@/lib/site-metadata';

export const metadata = pageMetadata('Shopping Bag', 'Review your private Rashi Kapoor shopping bag.', '/bag', { index: false });
export default function BagLayout({ children }: { children: ReactNode }) { return children; }
