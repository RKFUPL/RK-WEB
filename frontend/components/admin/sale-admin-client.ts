import { apiBaseUrl, getCurrentUser } from '@/lib/rbac';

export type SaleItem = { id?: string; productId: string; variantId: string; discountPercent: number };
export type SaleCampaign = {
  id: string; title: string; type: string; customType: string; slug: string; description: string;
  startsAt: string; endsAt: string; timezone: string; publication: string; state: string; revision: number;
  items: SaleItem[]; bannerUrl?: string; bannerMediaType?: 'image'|'video'; bannerMediaSource?: 'upload'|'workdrive'|'external'; bannerMimeType?: string; bannerOriginalFilename?: string|null; bannerMediaSize?: number|null; bannerSourceHost?: string|null; bannerPosterUrl?: string|null; bannerAltText?: string; bannerHeading: string; bannerSubtitle: string;
  ctaLabel: string; ctaDestination: string; createdBy?: string; createdByLabel?: string;
  showAnnouncementRunner?: boolean; announcementStartsAt?: string; announcementFeatured?: boolean;
  publiclyVisible?: boolean; updatedAt?: string;
};

export const saleField = 'w-full rounded-lg border border-[var(--admin-border)] bg-transparent px-3 py-2 text-sm focus:border-gold outline-none';
export const saleButton = 'rounded-lg border border-[var(--admin-border)] px-4 py-2 text-sm disabled:opacity-40 hover:border-gold';

export function saleHeaders() {
  return { Authorization: `Bearer ${window.localStorage.getItem('rk_access_token') || ''}` };
}

export async function saleApi(path: string, method = 'GET', body?: unknown, signal?: AbortSignal) {
  const response = await fetch(`${apiBaseUrl}/api/sales${path}`, {
    method, credentials: 'include',
    headers: { ...saleHeaders(), ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: body instanceof FormData ? body : JSON.stringify(body) } : {}), cache: 'no-store', signal,
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || 'Unable to update sale.');
  return payload;
}

export async function saleAccess() {
  const user = await getCurrentUser();
  return { allowed: user?.role === 'admin' || !!user?.permissions?.includes('sales:manage'), admin: user?.role === 'admin' };
}
