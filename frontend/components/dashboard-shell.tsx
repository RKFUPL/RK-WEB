'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { Bell, CalendarDays, ChevronDown, ChevronLeft, ChevronRight, LayoutDashboard, LogOut, Menu, Moon, Search, Settings, ShoppingBag, Sparkles, Sun, Users, X } from 'lucide-react';
import { logout, type Role } from '@/lib/rbac';
import { brandLogoUrl } from '@/lib/home-content';
import { useEffect, useState } from 'react';
import type { AuthUser } from '@/lib/rbac';

const groups = [
  { label: 'Overview', items: [{ href: '/admin', label: 'Dashboard', icon: LayoutDashboard }] },
  { label: 'Commerce', items: [{ href: '/admin/products', label: 'Products', icon: ShoppingBag }, { href: '/admin/orders', label: 'Orders', icon: ShoppingBag }, { href: '/admin/inventory', label: 'Inventory', icon: LayoutDashboard }, { href: '/admin/collections', label: 'Collections', icon: Sparkles }] },
  { label: 'Relationship', items: [{ href: '/admin/customers', label: 'Customers', icon: Users }, { href: '/admin/marketing', label: 'Marketing', icon: Sparkles }] },
  { label: 'Workspace', items: [{ href: '/admin/reports', label: 'Reports & analytics', icon: CalendarDays }, { href: '/admin/settings', label: 'Settings', icon: Settings }] },
];

export function DashboardShell({ role, title, children }: { role: Role; title: string; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [dark, setDark] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const pathname = usePathname();
  useEffect(() => {
    const cached = window.localStorage.getItem('rk_auth_user');
    if (cached) {
      try { setUser(JSON.parse(cached) as AuthUser); } catch { window.localStorage.removeItem('rk_auth_user'); }
    }
    const saved = window.localStorage.getItem('rk-theme') === 'dark';
    setDark(saved);
    document.documentElement.classList.toggle('dark', saved);
    const onThemeChange = (event: Event) => setDark((event as CustomEvent<boolean>).detail);
    window.addEventListener('rk-theme-change', onThemeChange);
    return () => window.removeEventListener('rk-theme-change', onThemeChange);
  }, []);
  return <div className="admin-app flex min-h-screen bg-[#f5f6f8] text-[#20242b] dark:bg-[#101114] dark:text-[#f5f2ee]">
    <aside className={`${mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'} ${open ? 'lg:w-[248px]' : 'lg:w-[78px]'} fixed inset-y-0 left-0 z-50 flex w-[248px] shrink-0 flex-col border-r border-black/[.07] bg-white px-4 py-5 transition-all duration-300 dark:border-white/[.08] dark:bg-[#17181c]`}>
      <div className="flex items-center justify-between px-2">
        <Link href="/" className="flex items-center gap-3 overflow-hidden"><img src={brandLogoUrl} alt="RK" className="rk-logo h-10 w-auto min-w-[42px]" />{open && <span className="whitespace-nowrap text-[11px] font-medium uppercase tracking-[.28em] text-[#7d838d]">Admin studio</span>}</Link>
        <button onClick={() => setMobileOpen(false)} className="lg:hidden"><X size={18} /></button>
      </div>
      <div className="mt-7 space-y-6 overflow-y-auto pb-5">
        {groups.map((group) => <div key={group.label}><p className={`${open ? 'px-3' : 'text-center'} mb-2 text-[10px] font-semibold uppercase tracking-[.16em] text-[#9aa0a8]`}>{open ? group.label : '···'}</p><nav className="space-y-1">{group.items.map(({ href, label, icon: Icon }) => <Link key={href} href={href} onClick={() => setMobileOpen(false)} className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-[#6e747d] transition hover:bg-[#f5f6f8] hover:text-[#20242b] dark:hover:bg-white/[.06] dark:hover:text-white ${pathname === href ? 'bg-[#f1f0ec] font-medium text-[#24211e] dark:bg-[#2b2925] dark:text-[#f3eadc]' : ''}`} aria-current={pathname === href ? 'page' : undefined}><Icon size={17} strokeWidth={1.7} />{open && <span>{label}</span>}</Link>)}</nav></div>)}
      </div>
      <div className="mt-auto border-t border-black/[.07] pt-4 dark:border-white/[.08]"><button onClick={logout} className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-[#8b9199] hover:bg-[#f5f6f8] ${!open ? 'justify-center' : ''}`}><LogOut size={17} />{open && 'Sign out'}</button></div>
    </aside>
    {mobileOpen && <button aria-label="Close menu" className="fixed inset-0 z-40 bg-black/30 lg:hidden" onClick={() => setMobileOpen(false)} />}
    <div className={`${open ? 'lg:pl-[248px]' : 'lg:pl-[78px]'} w-full transition-all duration-300`}>
      <header className="sticky top-0 z-30 flex h-[72px] items-center justify-between border-b border-black/[.07] bg-white/90 px-5 backdrop-blur-xl dark:border-white/[.08] dark:bg-[#17181c]/90 lg:px-8"><div className="flex items-center gap-3"><button onClick={() => { setOpen(!open); setMobileOpen(true); }} className="rounded-lg p-2 hover:bg-black/5 dark:hover:bg-white/10"><Menu size={20} /></button><div className="hidden h-9 w-[250px] items-center gap-2 rounded-lg border border-black/[.08] px-3 text-sm text-[#9aa0a8] sm:flex dark:border-white/[.1]"><Search size={16} />Search anything...</div></div><div className="flex items-center gap-2 sm:gap-4"><button className="hidden items-center gap-2 text-xs text-[#777e87] md:flex"><CalendarDays size={16} />Current period <ChevronDown size={14} /></button><button className="rounded-lg p-2 text-[#7e858e] hover:bg-black/5 dark:hover:bg-white/10"><Bell size={18} /></button><button onClick={() => { const next = !dark; window.localStorage.setItem('rk-theme', next ? 'dark' : 'light'); document.documentElement.classList.toggle('dark', next); setDark(next); window.dispatchEvent(new CustomEvent('rk-theme-change', { detail: next })); }} className="rounded-lg p-2 text-[#7e858e] hover:bg-black/5 dark:hover:bg-white/10" aria-label="Toggle dark mode">{dark ? <Sun size={18} /> : <Moon size={18} />}</button><div className="flex items-center gap-2 border-l border-black/[.08] pl-3 dark:border-white/[.1]"><span className="grid h-8 w-8 place-items-center rounded-full bg-[#d9b47b] text-xs font-semibold text-white">{(user?.displayName || user?.username || user?.email || 'A').slice(0, 1).toUpperCase()}</span><span className="hidden max-w-[150px] truncate text-sm font-medium sm:block">{user?.displayName || user?.username || user?.email || 'Account'}</span><ChevronDown size={14} className="text-[#8e949c]" /></div></div></header>
      <main className="mx-auto max-w-[1600px] p-5 lg:p-8"><div className="mb-7 flex flex-wrap items-end justify-between gap-4"><div><p className="mb-2 text-xs font-medium uppercase tracking-[.18em] text-[#9a7a4d]">{role} workspace</p><h1 className="text-[30px] font-semibold tracking-[-.04em]">{title}</h1><p className="mt-1 text-sm text-[#858b94]">Here&apos;s what&apos;s happening with your store today.</p></div>{children && <button className="flex items-center gap-2 rounded-lg bg-[#24211e] px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-[#9a7a4d]"><Sparkles size={16} /> Quick create <ChevronDown size={14} /></button>}</div>{children}</main>
    </div>
  </div>;
}
