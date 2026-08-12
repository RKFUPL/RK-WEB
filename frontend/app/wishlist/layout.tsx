import type { ReactNode } from 'react';
import { pageMetadata } from '@/lib/site-metadata';

export const metadata = pageMetadata('Wishlist', 'Review your private Rashi Kapoor wishlist.', '/wishlist', { index: false });
export default function WishlistLayout({ children }: { children: ReactNode }) { return children; }
