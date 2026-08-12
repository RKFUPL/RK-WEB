import type { MetadataRoute } from 'next';
import { collectionPages } from '@/lib/home-content';
import { siteUrl } from '@/lib/site-metadata';

const staticPaths = [
  '/',
  '/about-rk',
  '/careers',
  '/collections',
  '/rk-lookbooks',
];

export default function sitemap(): MetadataRoute.Sitemap {
  const paths = Array.from(new Set([...staticPaths, ...collectionPages.map((collection) => collection.route)]));
  return paths.map((path) => ({
    url: new URL(path, siteUrl).toString(),
    changeFrequency: path === '/' ? 'weekly' : 'monthly',
    priority: path === '/' ? 1 : path === '/collections' || path === '/rk-lookbooks' ? 0.9 : 0.7,
  }));
}
