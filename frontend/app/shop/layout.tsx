import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Shop | Rashi Kapoor',
  description: 'Explore available Rashi Kapoor pieces by collection, colour, size and category.',
};

export default function ShopLayout({ children }: { children: React.ReactNode }) {
  return children;
}
