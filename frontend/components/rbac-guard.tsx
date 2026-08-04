'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { getCurrentUser, type AuthUser, type Role } from '@/lib/rbac';

export function RbacGuard({ role, children }: { role: Role; children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    getCurrentUser().then((currentUser) => {
      if (!currentUser) {
        router.replace(`/account?next=${encodeURIComponent(pathname)}`);
      } else if (currentUser.role !== role) {
        router.replace(currentUser.role === 'admin' ? '/admin' : currentUser.role === 'staff' ? '/staff' : '/account');
      } else {
        setUser(currentUser);
      }
      setChecked(true);
    });
  }, [pathname, role, router]);

  if (!checked || !user) return <main className="min-h-screen bg-ivory p-10 text-sm text-charcoal/60">Loading secure area…</main>;
  return <>{children}</>;
}
