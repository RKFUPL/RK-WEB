import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Inter, Cormorant_Garamond } from 'next/font/google';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-body',
});

const cormorant = Cormorant_Garamond({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-display',
});

export const metadata: Metadata = {
  title: 'Rashi Kapoor | Luxury Womenswear',
  description: 'Luxury womenswear and editorial couture by Rashi Kapoor.',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${inter.variable} ${cormorant.variable} bg-ivory text-charcoal antialiased`}>
        {children}
      </body>
    </html>
  );
}
