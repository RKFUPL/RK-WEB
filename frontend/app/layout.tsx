import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import localFont from 'next/font/local';
import { Inter, Cormorant_Garamond } from 'next/font/google';
import './globals.css';
import { ThemeToggle } from '@/components/theme-toggle';
import { AnalyticsTracker } from '@/components/analytics-tracker';
import { siteUrl } from '@/lib/site-metadata';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-body',
});

const cormorant = Cormorant_Garamond({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-display',
});

const aakaar = localFont({
  src: '../../HV-Muse-Regular.otf',
  variable: '--font-aakaar',
});

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: 'Rashi Kapoor | Luxury Indian Womenswear',
    template: '%s | Rashi Kapoor',
  },
  description: 'Discover Rashi Kapoor luxury Indian womenswear, couture collections, campaign stories, and editorial lookbooks.',
  applicationName: 'Rashi Kapoor',
  alternates: { canonical: '/' },
  robots: { index: true, follow: true },
  openGraph: {
    type: 'website',
    siteName: 'Rashi Kapoor',
    title: 'Rashi Kapoor | Luxury Indian Womenswear',
    description: 'Discover luxury Indian womenswear, couture collections, campaign stories, and editorial lookbooks.',
    url: '/',
  },
  icons: {
    icon: 'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785305776/RK_LOGOMARK_t6untf.svg',
    shortcut: 'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785305776/RK_LOGOMARK_t6untf.svg',
  },
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body className={`${inter.variable} ${cormorant.variable} ${aakaar.variable} bg-ivory text-charcoal antialiased`}>
        <AnalyticsTracker />
        {children}
        <ThemeToggle />
      </body>
    </html>
  );
}
