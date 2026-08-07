import { apiBaseUrl } from '@/lib/rbac';

export type AnalyticsEventName = 'page_view' | 'product_view' | 'wishlist_add' | 'add_to_bag' | 'checkout_started';
export type AnalyticsProperties = {
  productId?: string;
  productName?: string;
  currency?: string;
  quantity?: number;
  value?: number;
};

const visitorKey = 'rk_analytics_visitor';
const sessionKey = 'rk_analytics_session';
const sourceKey = 'rk_analytics_source';
const memoryIds: Record<string, string> = {};

function anonymousId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

function storedId(storage: Storage, key: string) {
  try {
    const existing = storage.getItem(key);
    if (existing) return existing;
    const created = anonymousId();
    storage.setItem(key, created);
    return created;
  } catch {
    memoryIds[key] ??= anonymousId();
    return memoryIds[key];
  }
}

function acquisitionSource() {
  let stored = '';
  try { stored = window.sessionStorage.getItem(sourceKey) ?? ''; } catch { stored = ''; }
  if (stored) return stored;

  const campaign = new URLSearchParams(window.location.search).get('utm_source')?.toLowerCase() ?? '';
  const emailCampaign = ['email', 'newsletter', 'mail'].some((value) => campaign.includes(value));
  let source = emailCampaign ? 'email' : 'direct';
  if (!emailCampaign && document.referrer) {
    try {
      const host = new URL(document.referrer).hostname.toLowerCase();
      if (host && host !== window.location.hostname.toLowerCase()) {
        if (/(google|bing|yahoo|duckduckgo|baidu|yandex)/.test(host)) source = 'search';
        else if (/(instagram|facebook|linkedin|pinterest|twitter|x\.com|youtube|tiktok)/.test(host)) source = 'social';
        else source = 'referral';
      }
    } catch {
      source = 'direct';
    }
  }
  try { window.sessionStorage.setItem(sourceKey, source); } catch { /* Storage can be unavailable in private contexts. */ }
  return source;
}

export function trackAnalyticsEvent(event: AnalyticsEventName, properties: AnalyticsProperties = {}, path?: string) {
  if (typeof window === 'undefined') return;
  const payload = {
    event,
    visitorId: storedId(window.localStorage, visitorKey),
    sessionId: storedId(window.sessionStorage, sessionKey),
    path: path ?? window.location.pathname,
    source: acquisitionSource(),
    properties,
  };
  void fetch(`${apiBaseUrl}/api/analytics/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    keepalive: true,
  }).catch(() => undefined);
}
