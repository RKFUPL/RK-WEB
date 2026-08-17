'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { BarChart3, Bell, Boxes, CalendarDays, ChevronRight, FileText, FolderKanban, LayoutDashboard, Megaphone, Menu, Package, Search, Settings, ShoppingBag, UserCircle, Users, X } from 'lucide-react';
import { getCurrentUser, type AuthUser, type Role, type StaffPermission } from '@/lib/rbac';
import { brandLogoUrl } from '@/lib/home-content';
import { QuickCreate } from '@/components/admin/quick-create';

function dashboardGroups(role: Role, permissions: StaffPermission[] = []) {
  const base = role === 'admin' ? '/admin' : '/staff';
  const allowed = (permission: StaffPermission) => role === 'admin' || permissions.includes(permission);
  const shared = [
    { label: 'Overview', items: [{ href: base, label: 'Dashboard', icon: LayoutDashboard }] },
    { label: 'Commerce', items: [allowed('products:manage') ? { href: `${base}/products`, label: 'Products', icon: Package } : null, role === 'staff' && (allowed('products:manage') || allowed('inventory:manage')) ? { href: `${base}/collections`, label: 'Collections', icon: FolderKanban } : null, allowed('orders:manage') ? { href: `${base}/orders`, label: 'Orders', icon: ShoppingBag } : null, allowed('inventory:manage') ? { href: `${base}/inventory`, label: 'Inventory', icon: Boxes } : null, allowed('quotes:manage') ? { href: `${base}/quotes`, label: 'Quotes', icon: FileText } : null].filter(Boolean) as Array<{ href: string; label: string; icon: typeof Package }> },
    { label: 'Relationship', items: [role === 'admin' && allowed('customers:manage') ? { href: `${base}/customers`, label: 'Customers', icon: Users } : null].filter(Boolean) as Array<{ href: string; label: string; icon: typeof Users }> },
  ];
  if (role === 'staff') return shared.filter((group) => group.items.length);
  shared[1].items.push({ href: '/admin/collections', label: 'Collections', icon: FolderKanban });
  shared[2].items.push({ href: '/admin/marketing', label: 'Marketing', icon: Megaphone });
  return [...shared, { label: 'Workspace', items: [{ href: '/admin/users', label: 'Staff & access', icon: Users }, { href: '/admin/reports', label: 'Reports & analytics', icon: BarChart3 }, { href: '/admin/settings', label: 'Settings', icon: Settings }] }];
}

function haptic(duration = 7) {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate(duration);
}

export function DashboardShell({ role, title, children }: { role: Role; title: string; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const pathname = usePathname();
  const groups = dashboardGroups(role, user?.permissions);

  useEffect(() => {
    getCurrentUser().then(setUser);
    const saved = window.localStorage.getItem('rk-dashboard-sidebar');
    if (saved) setOpen(saved === 'open');
  }, []);

  useEffect(() => {
    window.localStorage.setItem('rk-dashboard-sidebar', open ? 'open' : 'closed');
  }, [open]);

  const displayName = [user?.firstName, user?.lastName].filter(Boolean).join(' ') || user?.displayName || user?.username || user?.email || 'Account';
  const username = user?.username ? `@${user.username}` : '';
  const toggleNavigation = () => {
    haptic();
    if (window.innerWidth < 1024) setMobileOpen(true);
    else setOpen((current) => !current);
  };

  return <div className="admin-app flex min-h-screen bg-[#f5f6f8] text-[#20242b] dark:bg-[#101114] dark:text-[#f5f2ee]">
    <aside aria-label={`${role} navigation`} className={`${mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'} ${open ? 'lg:w-[248px]' : 'lg:w-[96px]'} fixed inset-y-0 left-0 z-50 flex w-[272px] shrink-0 flex-col border-r border-black/[.07] bg-white px-4 py-5 shadow-2xl transition-[width,transform] duration-300 ease-out dark:border-white/[.08] dark:bg-[#17181c] lg:shadow-none`}>
      <div className="flex h-12 items-center justify-between px-2">
        <Link href="/" onClick={() => haptic()} className={`flex min-w-0 items-center gap-3 ${open ? '' : 'lg:w-full lg:justify-center'}`}><img src={brandLogoUrl} alt="RK home" className="rk-logo h-12 w-auto shrink-0 transition-transform duration-300 hover:scale-105" />{open ? <span className="truncate whitespace-nowrap text-[11px] font-medium uppercase tracking-[.28em] text-[#7d838d]">{role} studio</span> : null}</Link>
        <button type="button" onClick={() => { haptic(); setMobileOpen(false); }} aria-label="Close navigation" className="rounded-lg p-2 transition hover:bg-black/5 active:scale-90 dark:hover:bg-white/10 lg:hidden"><X size={18} /></button>
      </div>

      <div className="mt-7 flex-1 space-y-6 overflow-y-auto overflow-x-hidden pb-5 [scrollbar-width:thin]">
        {groups.map((group) => <section key={group.label} aria-label={group.label}>{open ? <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[.16em] text-[#9aa0a8]">{group.label}</p> : <div className="mx-auto mb-2 hidden h-px w-7 bg-black/[.08] dark:bg-white/[.1] lg:block" />}<nav className="space-y-1">{group.items.map(({ href, label, icon: Icon }) => { const active = pathname === href; return <Link key={href} href={href} title={!open ? label : undefined} aria-label={label} aria-current={active ? 'page' : undefined} onClick={() => { haptic(); setMobileOpen(false); }} className={`group relative flex min-h-11 items-center gap-3 overflow-hidden rounded-xl px-3 text-sm transition-all duration-200 active:scale-[.97] ${!open ? 'lg:justify-center' : ''} ${active ? 'bg-[#f1f0ec] font-medium text-[#24211e] shadow-[inset_0_0_0_1px_rgba(154,122,77,.08)] dark:bg-[#2b2925] dark:text-[#f3eadc]' : 'text-[#6e747d] hover:translate-x-0.5 hover:bg-[#f5f6f8] hover:text-[#20242b] dark:hover:bg-white/[.06] dark:hover:text-white'}`}>{active ? <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-[#b28a51]" /> : null}<Icon size={18} strokeWidth={active ? 2 : 1.7} className="shrink-0 transition-transform duration-200 group-hover:scale-110" />{open ? <span className="whitespace-nowrap">{label}</span> : null}</Link>; })}</nav></section>)}
      </div>

      <div className="mt-auto border-t border-black/[.07] pt-4 dark:border-white/[.08]"><Link href="/profile" onClick={() => { haptic(); setMobileOpen(false); }} title={!open ? 'Profile' : undefined} className={`group flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm text-[#7d838d] transition-all hover:bg-[#f5f6f8] hover:text-[#20242b] active:scale-[.97] dark:hover:bg-white/[.06] dark:hover:text-white ${!open ? 'lg:justify-center' : ''}`}><UserCircle size={18} className="shrink-0 transition-transform group-hover:scale-110" />{open ? <span>Profile</span> : null}</Link></div>
    </aside>

    {mobileOpen ? <button type="button" aria-label="Close navigation" className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[1px] lg:hidden" onClick={() => setMobileOpen(false)} /> : null}

    <div className={`${open ? 'lg:pl-[248px]' : 'lg:pl-[96px]'} w-full transition-[padding] duration-300 ease-out`}>
      <header className="sticky top-0 z-30 flex h-[72px] items-center justify-between border-b border-black/[.07] bg-white/90 px-5 backdrop-blur-xl dark:border-white/[.08] dark:bg-[#17181c]/90 lg:px-8">
        <div className="flex items-center gap-3"><button type="button" onClick={toggleNavigation} aria-label={mobileOpen ? 'Close navigation' : open ? 'Collapse navigation' : 'Expand navigation'} className="rounded-lg p-2 transition hover:bg-black/5 active:scale-90 dark:hover:bg-white/10"><Menu size={20} /></button><label className="hidden h-9 w-[250px] items-center gap-2 rounded-lg border border-black/[.08] px-3 text-sm text-[#9aa0a8] transition focus-within:border-[#9a7a4d] sm:flex dark:border-white/[.1]"><Search size={16} /><input aria-label="Search dashboard" placeholder="Search anything..." className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-[#9aa0a8]" /></label></div>
        <div className="flex items-center gap-2 sm:gap-4"><span className="hidden items-center gap-2 text-xs text-[#777e87] md:flex"><CalendarDays size={16} />Live metrics</span><button type="button" title="No new notifications" aria-label="Notifications: none unread" className="rounded-lg p-2 text-[#7e858e] transition hover:bg-black/5 active:scale-90 dark:hover:bg-white/10"><Bell size={18} /></button><Link href="/profile" aria-label="Open user profile" onClick={() => haptic()} className="flex items-center gap-2 border-l border-black/[.08] pl-3 transition hover:text-[#9a7a4d] active:scale-[.98] dark:border-white/[.1]"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#d9b47b] text-xs font-semibold text-white">{displayName.slice(0, 1).toUpperCase()}</span><span className="hidden max-w-[170px] sm:block"><span className="block truncate text-sm font-medium leading-tight">{displayName}</span>{username ? <span className="mt-0.5 block truncate text-[11px] leading-tight text-[#8e949c]">{username}</span> : null}</span><ChevronRight size={14} className="text-[#8e949c] transition-transform group-hover:translate-x-0.5" /></Link></div>
      </header>
      <main className="mx-auto max-w-[1600px] p-5 lg:p-8"><div className="mb-7 flex flex-wrap items-end justify-between gap-4"><div><p className="mb-2 text-xs font-medium uppercase tracking-[.18em] text-[#9a7a4d]">{role} workspace</p><h1 className="text-[30px] font-semibold tracking-[-.04em]">{title}</h1><p className="mt-1 text-sm text-[#858b94]">Here&apos;s what&apos;s happening with your store today.</p></div><QuickCreate pathname={pathname} role={role} /></div>{children}</main>
    </div>
  </div>;
}
