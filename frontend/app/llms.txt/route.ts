import { collectionGalleryPages } from '@/lib/home-content';
import { siteUrl } from '@/lib/site-metadata';

export function GET() {
  const collectionLinks = collectionGalleryPages.map((collection) => `- [${collection.name}](${siteUrl}${collection.route})`).join('\n');
  const content = `# Rashi Kapoor

> Luxury Indian womenswear and couture, presented through collections and editorial lookbooks.

## Main pages
- [Home](${siteUrl}/)
- [Collections](${siteUrl}/collections)
- [Lookbooks](${siteUrl}/rk-lookbooks)
- [Runway](${siteUrl}/runway)
- [About Rashi Kapoor](${siteUrl}/about-rk)

## Collections
${collectionLinks}
`;
  return new Response(content, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
