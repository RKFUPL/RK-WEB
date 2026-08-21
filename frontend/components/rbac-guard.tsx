'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { getCurrentUser, type AuthUser, type Role } from '@/lib/rbac';

export function RbacGuard({ role, children }: { role?: Role; children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [checked, setChecked] = useState(false);

  pathnameRef.current = pathname;

  useEffect(() => {
    getCurrentUser().then((currentUser) => {
      if (!currentUser) {
        router.replace(`/account?next=${encodeURIComponent(pathnameRef.current)}`);
      } else if (role && currentUser.role !== role) {
        router.replace(currentUser.role === 'admin' ? '/admin' : currentUser.role === 'staff' ? '/staff' : '/account');
      } else {
        setUser(currentUser);
      }
      setChecked(true);
    });
  }, [role, router]);

  if (!checked || !user) return <main className="min-h-screen bg-ivory p-10 text-sm text-charcoal/60">Loading secure area…</main>;
  return <>{children}</>;
}
