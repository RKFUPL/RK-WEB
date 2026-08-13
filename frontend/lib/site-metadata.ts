import type { Metadata } from 'next';

export const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://physihome.shop';

export function pageMetadata(
  title: string,
  description: string,
  path: string,
  options: { index?: boolean } = {},
): Metadata {
  const canonicalPath = path.startsWith('/') ? path : `/${path}`;
  const canonical = new URL(canonicalPath, siteUrl).toString();
  const index = options.index !== false;

  return {
    title,
    description,
    alternates: { canonical },
    robots: { index, follow: index },
    openGraph: {
      type: 'website',
      siteName: 'Rashi Kapoor',
      title,
      description,
      url: canonical,
    },
  };
}
