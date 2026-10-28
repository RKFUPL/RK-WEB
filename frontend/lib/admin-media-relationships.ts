import type { AdminMediaEntry } from '@/lib/catalog';

export const INITIAL_MEDIA_RELATIONSHIP_COUNT = 3;

export function visibleMediaRelationships<T>(entries: T[], expanded: boolean) {
  return expanded ? entries : entries.slice(0, INITIAL_MEDIA_RELATIONSHIP_COUNT);
}

export function adminMediaRelationshipPreview(productId: string, entry: AdminMediaEntry) {
  const relationshipId = String(entry.identity || '').trim();
  if (/^[a-f0-9]{24,64}$/i.test(relationshipId) || /^[0-9a-f-]{36}$/i.test(relationshipId)) {
    return `/api/staff/products/${encodeURIComponent(productId)}/media/${encodeURIComponent(relationshipId)}`;
  }
  const source = String(entry.permalink || '').trim();
  if (!source || /workdrive\.zoho(?:external)?\.in/i.test(source)) return '';
  if (source.startsWith('/') && !source.startsWith('//')) return source;
  try {
    const parsed = new URL(source);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password ? source : '';
  } catch {
    return '';
  }
}
