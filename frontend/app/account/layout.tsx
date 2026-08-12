import type { ReactNode } from 'react';
import { pageMetadata } from '@/lib/site-metadata';

export const metadata = pageMetadata('Account', 'Sign in to manage your private Rashi Kapoor account.', '/account', { index: false });

export default function AccountLayout({ children }: { children: ReactNode }) {
  return children;
}
