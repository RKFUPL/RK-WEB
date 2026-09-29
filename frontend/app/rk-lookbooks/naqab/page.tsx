import { notFound } from 'next/navigation';
import { pageMetadata } from '@/lib/site-metadata';

export const metadata = pageMetadata('Naqab Lookbook', 'Enter the Naqab editorial lookbook by Rashi Kapoor, a cinematic study of layered silhouettes and evening presence.', '/rk-lookbooks/naqab', { index: false });

export default function NaqabLookbookPage() {
  notFound();
}
