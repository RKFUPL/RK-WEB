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
    if (lastTrackedPath !== pathname || now - lastTrackedAt >= 1000) {
      lastTrackedPath = pathname;
      lastTrackedAt = now;
      trackAnalyticsEvent('page_view', { pageTitle: document.title }, pathname);
    }

    const reportPresence = () => {
      if (document.visibilityState === 'visible') {
        trackAnalyticsEvent('presence', { pageTitle: document.title }, pathname);
      }
    };
    const presenceTimer = window.setInterval(reportPresence, 45_000);
    document.addEventListener('visibilitychange', reportPresence);

    return () => {
      window.clearInterval(presenceTimer);
      document.removeEventListener('visibilitychange', reportPresence);
    };
  }, [pathname]);

  return null;
}
