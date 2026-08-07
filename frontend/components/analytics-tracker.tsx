'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { trackAnalyticsEvent } from '@/lib/analytics';

let lastTrackedPath = '';
let lastTrackedAt = 0;

export function AnalyticsTracker() {
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname || ['/admin', '/staff', '/account', '/profile'].some((prefix) => pathname.startsWith(prefix))) return;
    const now = Date.now();
    if (lastTrackedPath === pathname && now - lastTrackedAt < 1000) return;
    lastTrackedPath = pathname;
    lastTrackedAt = now;
    trackAnalyticsEvent('page_view', {}, pathname);
  }, [pathname]);

  return null;
}
