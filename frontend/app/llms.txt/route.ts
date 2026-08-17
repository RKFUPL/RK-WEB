import { siteUrl } from '@/lib/site-metadata';

export function GET() {
  const content = `# Rashi Kapoor

> Luxury Indian womenswear and couture, presented through collections and editorial lookbooks.

## Main pages
- [Home](${siteUrl}/)
- [Collections](${siteUrl}/collections)
- [Lookbooks](${siteUrl}/rk-lookbooks)
- [About Rashi Kapoor](${siteUrl}/about-rk)

## Collections
- [Anamika](${siteUrl}/collections/collections-of-anamika)
- [Hastakala](${siteUrl}/collections/collections-of-hasthkala)
- [Inaara](${siteUrl}/collections/collections-of-inaara)
- [Naqab](${siteUrl}/collections/collections-of-naqab)
- [Sandook](${siteUrl}/collections/collections-of-sandook)
`;
  return new Response(content, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
