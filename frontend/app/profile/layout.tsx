import type { ReactNode } from 'react';
import { pageMetadata } from '@/lib/site-metadata';

export const metadata = pageMetadata('Profile', 'Manage your private Rashi Kapoor profile.', '/profile', { index: false });
export default function ProfileLayout({ children }: { children: ReactNode }) { return children; }
