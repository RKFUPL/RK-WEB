'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { logout, type Role } from '@/lib/rbac';

const navigation: Record<Role, Array<{ href: string; label: string }>> = {
  customer: [
    { href: '/account', label: 'Overview' }, { href: '/account/orders', label: 'Orders' },
    { href: '/wishlist', label: 'Wishlist' }, { href: '/bag', label: 'Bag' },
  ],
  staff: [
    { href: '/staff', label: 'Dashboard' }, { href: '/staff/products', label: 'Products & inventory' },
    { href: '/staff/collections', label: 'Collections & lookbooks' }, { href: '/staff/orders', label: 'Orders' },
    { href: '/staff/customers', label: 'Customers' },
  ],
  admin: [
    { href: '/admin', label: 'Dashboard' }, { href: '/admin/users', label: 'Users & roles' },
    { href: '/admin/orders', label: 'Orders & refunds' }, { href: '/admin/content', label: 'Content & coupons' },
    { href: '/admin/reports', label: 'Analytics & reports' }, { href: '/admin/settings', label: 'Site & security settings' },
  ],
};

export function DashboardShell({ role, title, children }: { role: Role; title: string; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-ivory text-charcoal lg:flex">
      <aside className="w-full border-b border-black/10 bg-white p-6 lg:min-h-screen lg:w-72 lg:border-b-0 lg:border-r lg:p-8">
        <Link href="/" className="font-display text-3xl">Rashi Kapoor</Link>
        <p className="mt-3 text-[10px] uppercase tracking-[0.3em] text-charcoal/45">{role} area</p>
        <nav className="mt-10 space-y-3">
          {navigation[role].map((item) => <Link key={item.href} href={item.href} className="block py-2 text-xs uppercase tracking-[0.18em] text-charcoal/65 transition hover:text-gold">{item.label}</Link>)}
        </nav>
        <button type="button" onClick={logout} className="mt-10 text-xs uppercase tracking-[0.18em] text-charcoal/50 hover:text-gold">Logout</button>
      </aside>
      <main className="flex-1 p-6 lg:p-12"><p className="text-xs uppercase tracking-[0.3em] text-charcoal/45">{role} dashboard</p><h1 className="mt-4 font-display text-6xl">{title}</h1>{children}</main>
    </div>
  );
}
