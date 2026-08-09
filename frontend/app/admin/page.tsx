'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BarChart3, Boxes, DollarSign, Eye, Globe2, Heart, Monitor, Package, ShoppingBag, Smartphone, Star, Tablet, Users, X, Zap } from 'lucide-react';
import { apiBaseUrl } from '@/lib/rbac';

type Period = '7d' | '30d' | '90d';
type DashboardData = {
  period: Period;
  generatedAt: string;
  currency: string;
  metrics: {
    revenue: number;
    orders: number;
    visitors: number;
    pageViews: number;
    activeVisitors: number;
    conversionRate: number;
    lowStock: number;
    newCustomers: number;
    wishlistAdds: number;
    averageRating: number;
  };
  sales: Array<{ date: string; orders: number; revenue: number }>;
  trafficSources: Array<{ source: string; visitors: number; views: number }>;
  visitorsList: Array<{
    label: string;
    kind: 'customer' | 'visitor';
    customerName: string | null;
    key: string;
    source: string;
    device: string;
    browser: string;
    os: string;
    lastPath: string;
    views: number;
    sessions: number;
    pages: number;
    firstSeen: string | null;
    lastSeen: string | null;
    active: boolean;
    current: boolean;
  }>;
  newCustomersList: Array<{ id: string; name: string; email: string; username: string; createdAt: string | null }>;
  bestSellingProducts: Array<{ id: string; name: string; units: number; revenue: number }>;
  activity: Array<{ id: string; type: string; label: string; detail: string; createdAt: string | null }>;
};

const currency = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const integer = new Intl.NumberFormat('en-IN');
const periodLabels: Record<Period, string> = { '7d': 'Last 7 days', '30d': 'Last 30 days', '90d': 'Last 90 days' };

function Card({ children, className = '', onClick }: { children: React.ReactNode; className?: string; onClick?: () => void }) {
  return <section onClick={onClick} onKeyDown={onClick ? (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onClick(); } } : undefined} role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined} className={`rounded-2xl border border-black/[.06] bg-white p-5 shadow-[0_4px_20px_rgba(25,31,38,.035)] dark:border-white/[.08] dark:bg-[#191a1f] ${onClick ? 'cursor-pointer transition hover:-translate-y-0.5 hover:border-[#d9b47b] focus:outline-none focus:ring-2 focus:ring-[#d9b47b]/50' : ''} ${className}`}>{children}</section>;
}

function Empty({ title, copy }: { title: string; copy: string }) {
  return <div className="flex min-h-[150px] flex-col items-center justify-center text-center"><BarChart3 size={23} className="text-[#b6bbc1]" /><p className="mt-3 text-sm font-medium">{title}</p><p className="mt-1 max-w-sm text-xs text-[#9298a0]">{copy}</p></div>;
}

function relativeTime(value: string | null) {
  if (!value) return '';
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export default function AdminDashboard() {
  const [period, setPeriod] = useState<Period>('7d');
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedVisitor, setSelectedVisitor] = useState<DashboardData['visitorsList'][number] | null>(null);
  const [sourceFilter, setSourceFilter] = useState<string | null>(null);
  const [audiencePopup, setAudiencePopup] = useState<'visitors' | 'customers' | null>(null);
  const visitorPanelRef = useRef<HTMLDivElement | null>(null);

  const loadDashboard = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const token = window.localStorage.getItem('rk_access_token') ?? '';
      const visitorId = window.localStorage.getItem('rk_analytics_visitor') ?? '';
      const response = await fetch(`${apiBaseUrl}/api/admin/dashboard?period=${period}`, {
        headers: { Authorization: `Bearer ${token}`, 'X-RK-Visitor-ID': visitorId },
        cache: 'no-store',
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? 'Unable to load dashboard data.');
      setData(payload as DashboardData);
      setError('');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to load dashboard data.');
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    void loadDashboard();
    const refresh = window.setInterval(() => void loadDashboard(true), 30_000);
    return () => window.clearInterval(refresh);
  }, [loadDashboard]);

  const metrics = data?.metrics;
  const metricCards = [
    ['Revenue', metrics ? currency.format(metrics.revenue) : '—', DollarSign, periodLabels[period]],
    ['Orders', metrics ? integer.format(metrics.orders) : '—', ShoppingBag, periodLabels[period]],
    ['Unique visitors', metrics ? integer.format(metrics.visitors) : '—', Eye, metrics ? `${integer.format(metrics.pageViews)} page views` : periodLabels[period]],
    ['Conversion rate', metrics ? `${metrics.conversionRate.toFixed(2)}%` : '—', Zap, periodLabels[period]],
    ['Low stock alerts', metrics ? integer.format(metrics.lowStock) : '—', Package, 'Current inventory'],
    ['New customers', metrics ? integer.format(metrics.newCustomers) : '—', Users, periodLabels[period]],
    ['Wishlist adds', metrics ? integer.format(metrics.wishlistAdds) : '—', Heart, periodLabels[period]],
    ['Average rating', metrics && metrics.averageRating ? metrics.averageRating.toFixed(1) : '—', Star, periodLabels[period]],
  ] as const;

  const maxSales = useMemo(() => Math.max(1, ...(data?.sales.map((point) => Math.max(point.revenue, point.orders)) ?? [1])), [data]);
  const maxTraffic = useMemo(() => Math.max(1, ...(data?.trafficSources.map((source) => source.visitors) ?? [1])), [data]);
  const visitorDeviceIcon = (device: string) => device === 'mobile' ? Smartphone : device === 'tablet' ? Tablet : Monitor;
  const visibleVisitors = data?.visitorsList.filter((visitor) => !sourceFilter || visitor.source === sourceFilter) ?? [];
  const chooseTrafficSource = (source: string) => {
    setSourceFilter((current) => current === source ? null : source);
    window.setTimeout(() => visitorPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };

  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2 text-xs text-[#7d838d]"><span className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_0_4px_rgba(16,185,129,.12)]" />Live backend data · refreshes every 30 seconds</div>
      <div className="flex items-center gap-3"><label htmlFor="dashboard-period" className="text-[10px] uppercase tracking-[.16em] text-[#9298a0]">Period</label><select id="dashboard-period" value={period} onChange={(event) => setPeriod(event.target.value as Period)} className="rounded-lg border border-black/[.08] bg-white px-3 py-2 text-xs outline-none focus:border-[#9a7a4d] dark:border-white/[.1] dark:bg-[#191a1f]">{Object.entries(periodLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
    </div>

    {error ? <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error} Existing values remain visible while the dashboard retries automatically.</div> : null}

    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{metricCards.slice(0, 4).map(([label, value, Icon, detail]) => <Card key={label} onClick={label === 'Unique visitors' ? () => setAudiencePopup('visitors') : undefined}><span className="grid h-9 w-9 place-items-center rounded-xl bg-[#f4efe7] text-[#9a7a4d]"><Icon size={17} /></span><p className="mt-5 text-xs text-[#8a9098]">{label}</p><p className="mt-1 text-2xl font-semibold tracking-[-.04em]">{loading && !data ? '…' : value}</p><p className="mt-2 text-[11px] text-[#a2a7ad]">{detail}</p>{label === 'Unique visitors' ? <p className="mt-3 text-[10px] uppercase tracking-[.12em] text-[#9a7a4d]">Tap to view visitors</p> : null}</Card>)}</div>

    <div className="grid gap-5 xl:grid-cols-[1.6fr_1fr]">
      <Card><div className="flex items-center justify-between"><div><h2 className="text-[15px] font-semibold">Sales performance</h2><p className="mt-1 text-xs text-[#8a9098]">Revenue and order volume from the orders collection.</p></div><span className="rounded-lg bg-[#f5f6f8] px-3 py-2 text-xs text-[#8a9098] dark:bg-white/[.06]">{data ? currency.format(data.metrics.revenue) : 'Loading…'}</span></div>{data?.sales.some((point) => point.revenue || point.orders) ? <div className="mt-8 flex h-44 items-end gap-1" aria-label="Sales performance chart">{data.sales.map((point, index) => { const height = Math.max(point.revenue, point.orders) / maxSales * 100; const showLabel = index === 0 || index === data.sales.length - 1 || data.sales.length <= 7; return <div key={point.date} className="group flex min-w-0 flex-1 flex-col items-center justify-end gap-2"><div title={`${point.date}: ${currency.format(point.revenue)}, ${point.orders} orders`} style={{ height: `${Math.max(4, height)}%` }} className="w-full max-w-8 rounded-t bg-[#d9b47b] transition hover:bg-[#9a7a4d]" /><span className="h-3 truncate text-[8px] text-[#9aa0a8]">{showLabel ? point.date.slice(5) : ''}</span></div>; })}</div> : <Empty title="No sales yet" copy="Completed orders will populate this chart automatically." />}</Card>
      <Card><div className="flex items-center justify-between"><h2 className="text-[15px] font-semibold">Traffic sources</h2><span className="text-xs text-[#8a9098]">{metrics ? `${metrics.visitors} visitors` : 'Loading…'}</span></div>{data?.trafficSources.length ? <div className="mt-7 space-y-5">{data.trafficSources.map((source) => <button type="button" key={source.source} onClick={() => chooseTrafficSource(source.source)} className={`block w-full text-left transition ${sourceFilter === source.source ? 'opacity-100' : 'opacity-85 hover:opacity-100'}`} aria-pressed={sourceFilter === source.source}><div className="mb-2 flex items-center justify-between text-xs"><span className="capitalize">{source.source}</span><span className="text-[#8a9098]">{source.visitors} visitors · {source.views} views</span></div><div className="h-1.5 overflow-hidden rounded-full bg-[#eceef0] dark:bg-white/[.08]"><div className="h-full rounded-full bg-[#9a7a4d]" style={{ width: `${source.visitors / maxTraffic * 100}%` }} /></div></button>)}</div> : <Empty title="No traffic yet" copy="New storefront visits will appear here automatically." />}</Card>
    </div>

    <div className="grid gap-5 xl:grid-cols-[1.35fr_1fr]">
      <Card><div className="flex items-center justify-between"><h2 className="text-[15px] font-semibold">Best selling products</h2><Boxes size={17} className="text-[#a5abb2]" /></div>{data?.bestSellingProducts.length ? <div className="mt-6 divide-y divide-black/[.06] dark:divide-white/[.08]">{data.bestSellingProducts.map((product, index) => <div key={product.id} className="flex items-center gap-4 py-3"><span className="grid h-7 w-7 place-items-center rounded-full bg-[#f4efe7] text-xs text-[#9a7a4d]">{index + 1}</span><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{product.name}</p><p className="mt-1 text-xs text-[#9298a0]">{product.units} units sold</p></div><span className="text-sm">{currency.format(product.revenue)}</span></div>)}</div> : <Empty title="No product sales yet" copy="Products are ranked from real order line items." />}</Card>
      <Card><div className="flex items-center justify-between"><h2 className="text-[15px] font-semibold">Live activity</h2><span className="text-[10px] uppercase tracking-[.14em] text-emerald-600">Live</span></div>{data?.activity.length ? <div className="mt-5 max-h-64 divide-y divide-black/[.06] overflow-y-auto dark:divide-white/[.08]">{data.activity.map((entry) => <div key={`${entry.type}-${entry.id}`} className="flex gap-3 py-3"><span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[#d9b47b]" /><div className="min-w-0 flex-1"><p className="text-xs font-medium">{entry.label}</p><p className="mt-1 truncate text-[11px] text-[#9298a0]">{entry.detail}</p></div><span className="whitespace-nowrap text-[10px] text-[#a2a7ad]">{relativeTime(entry.createdAt)}</span></div>)}</div> : <Empty title="No recent activity" copy="Page views, customer actions, and orders will appear here." />}</Card>
    </div>

    <div ref={visitorPanelRef} className="scroll-mt-24"><Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="text-[15px] font-semibold">Customers & visitors</h2><p className="mt-1 text-xs text-[#8a9098]">Signed-in customers show their account name. Other sessions remain anonymous visitors.</p>{sourceFilter ? <button type="button" onClick={() => setSourceFilter(null)} className="mt-2 text-[10px] uppercase tracking-[.12em] text-[#9a7a4d] hover:underline">Showing {sourceFilter} · Clear filter</button> : null}</div>
        <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-[10px] font-medium uppercase tracking-[.12em] text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />{metrics ? `${metrics.activeVisitors} live · ${data?.visitorsList.filter((visitor) => visitor.current).length ?? 0} current device` : 'Loading'}</span>
      </div>
      {visibleVisitors.length ? <div className="mt-5 overflow-x-auto"><table className="w-full min-w-[720px] text-left"><thead><tr className="border-b border-black/[.06] text-[10px] uppercase tracking-[.14em] text-[#9aa0a8] dark:border-white/[.08]"><th className="pb-3 font-medium">Customer / visitor</th><th className="pb-3 font-medium">Last page</th><th className="pb-3 font-medium">Source</th><th className="pb-3 font-medium">Device</th><th className="pb-3 font-medium">Activity</th><th className="pb-3 text-right font-medium">Last seen</th></tr></thead><tbody className="divide-y divide-black/[.06] dark:divide-white/[.08]">{visibleVisitors.map((visitor) => { const DeviceIcon = visitorDeviceIcon(visitor.device); return <tr key={`${visitor.key}-${visitor.lastSeen}`} role="button" tabIndex={0} onClick={() => setSelectedVisitor(visitor)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedVisitor(visitor); } }} className="cursor-pointer text-xs transition hover:bg-[#faf8f4] focus:bg-[#faf8f4] focus:outline-none dark:hover:bg-white/[.03] dark:focus:bg-white/[.03]"><td className="py-3"><div className="flex items-center gap-3"><span className={`grid h-8 w-8 place-items-center rounded-full ${visitor.active || visitor.current ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400' : 'bg-[#f4efe7] text-[#9a7a4d]'}`}><Globe2 size={15} /></span><div><p className="font-medium">{visitor.label}{visitor.kind === 'customer' ? <span className="ml-2 text-[10px] font-normal text-[#9a7a4d]">Customer</span> : <span className="ml-2 text-[10px] font-normal text-[#9298a0]">Visitor</span>}{visitor.current ? <span className="ml-2 text-[10px] font-normal text-emerald-600">Current device</span> : null}</p><p className="mt-0.5 text-[10px] text-[#9aa0a8]">ID …{visitor.key}</p></div></div></td><td className="max-w-[190px] truncate py-3 text-[#6e747d]" title={visitor.lastPath}>{visitor.lastPath}</td><td className="py-3 capitalize text-[#6e747d]">{visitor.source}</td><td className="py-3"><div className="flex items-center gap-2 text-[#6e747d]"><DeviceIcon size={15} /><span>{visitor.device} · {visitor.browser}</span></div></td><td className="py-3 text-[#6e747d]">{visitor.views} views · {visitor.pages} pages</td><td className="py-3 text-right text-[#9298a0]">{visitor.current ? <span className="mr-2 text-emerald-600">Current device</span> : visitor.active ? <span className="mr-2 text-emerald-600">Live</span> : null}{relativeTime(visitor.lastSeen)}</td></tr>; })}</tbody></table></div> : <Empty title="No visitors yet" copy="Once someone opens the storefront, their anonymous session will appear here." />}
    </Card></div>

    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{metricCards.slice(4).map(([label, value, Icon, detail]) => <Card key={label} onClick={label === 'New customers' ? () => setAudiencePopup('customers') : undefined}><span className="grid h-9 w-9 place-items-center rounded-xl bg-[#f4efe7] text-[#9a7a4d]"><Icon size={17} /></span><p className="mt-4 text-xs text-[#8a9098]">{label}</p><p className="mt-1 text-2xl font-semibold">{loading && !data ? '…' : value}</p><p className="mt-2 text-[11px] text-[#a2a7ad]">{detail}</p>{label === 'New customers' ? <p className="mt-3 text-[10px] uppercase tracking-[.12em] text-[#9a7a4d]">Tap to view customers</p> : null}</Card>)}</div>

    <Card className="bg-[#27231f] text-[#f8f3eb] dark:bg-[#302a24]"><h2 className="text-[15px] font-semibold">Data coverage</h2><p className="mt-2 text-sm leading-6 text-white/60">Traffic is collected from storefront page views. Revenue, orders, best sellers, stock, customers, wishlists, and ratings are calculated from their corresponding backend records and events—no dashboard value is hardcoded.</p>{data ? <p className="mt-3 text-[10px] uppercase tracking-[.16em] text-white/35">Last updated {new Date(data.generatedAt).toLocaleTimeString()}</p> : null}</Card>

    {selectedVisitor ? <div className="fixed inset-0 z-[100] grid place-items-center bg-black/45 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedVisitor(null); }}><section role="dialog" aria-modal="true" aria-labelledby="visitor-details-title" className="w-full max-w-md rounded-2xl border border-black/10 bg-white p-6 text-[#20242b] shadow-2xl dark:border-white/10 dark:bg-[#191a1f] dark:text-white"><div className="flex items-start justify-between gap-4"><div><p className="text-[10px] uppercase tracking-[.18em] text-[#9a7a4d]">{selectedVisitor.kind === 'customer' ? 'Customer details' : 'Visitor details'}</p><h2 id="visitor-details-title" className="mt-2 text-xl font-semibold">{selectedVisitor.label}</h2><p className="mt-1 text-xs text-[#9298a0]">{selectedVisitor.kind === 'customer' ? 'Registered customer' : `Anonymous ID …${selectedVisitor.key}`}</p></div><button type="button" onClick={() => setSelectedVisitor(null)} aria-label="Close visitor details" className="rounded-lg p-2 transition hover:bg-black/5 dark:hover:bg-white/10"><X size={18} /></button></div><div className="mt-6 grid grid-cols-2 gap-3 text-sm">{[['Type', selectedVisitor.kind === 'customer' ? 'Customer' : 'Visitor'], ['Status', selectedVisitor.current ? 'Current device' : selectedVisitor.active ? 'Live now' : 'Inactive'], ['Source', selectedVisitor.source], ['Device', selectedVisitor.device], ['Browser', selectedVisitor.browser], ['Operating system', selectedVisitor.os], ['Last page', selectedVisitor.lastPath], ['Views', String(selectedVisitor.views)], ['Pages', String(selectedVisitor.pages)], ['Sessions', String(selectedVisitor.sessions)], ['Last seen', relativeTime(selectedVisitor.lastSeen)]].map(([label, value]) => <div key={label} className="rounded-xl bg-[#f7f7f5] p-3 dark:bg-white/[.05]"><p className="text-[10px] uppercase tracking-[.12em] text-[#9298a0]">{label}</p><p className="mt-1 truncate capitalize">{value}</p></div>)}</div><p className="mt-5 text-xs leading-5 text-[#9298a0]">Anonymous visitors never expose names, email addresses, IP addresses, or other sensitive identity data.</p></section></div> : null}
    {audiencePopup ? <div className="fixed inset-0 z-[100] grid place-items-center bg-black/45 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setAudiencePopup(null); }}><section role="dialog" aria-modal="true" aria-labelledby="audience-popup-title" className="w-full max-w-lg rounded-2xl border border-black/10 bg-white p-6 text-[#20242b] shadow-2xl dark:border-white/10 dark:bg-[#191a1f] dark:text-white"><div className="flex items-start justify-between gap-4"><div><p className="text-[10px] uppercase tracking-[.18em] text-[#9a7a4d]">Audience</p><h2 id="audience-popup-title" className="mt-2 text-xl font-semibold">{audiencePopup === 'customers' ? 'New customers' : 'Unique visitors'}</h2><p className="mt-1 text-xs text-[#9298a0]">{audiencePopup === 'customers' ? 'Customers registered during the selected period.' : 'Distinct storefront visitors during the selected period.'}</p></div><button type="button" onClick={() => setAudiencePopup(null)} aria-label="Close audience popup" className="rounded-lg p-2 transition hover:bg-black/5 dark:hover:bg-white/10"><X size={18} /></button></div>{audiencePopup === 'customers' ? data?.newCustomersList.length ? <div className="mt-6 max-h-[55vh] divide-y divide-black/[.06] overflow-y-auto dark:divide-white/[.08]">{data.newCustomersList.map((customer) => <div key={customer.id} className="py-4"><p className="text-sm font-medium">{customer.name}</p><p className="mt-1 text-xs text-[#9298a0]">{customer.email || (customer.username ? `@${customer.username}` : 'No contact details')}</p><p className="mt-1 text-[10px] text-[#b0b4ba]">Joined {customer.createdAt ? new Date(customer.createdAt).toLocaleDateString() : 'recently'}</p></div>)}</div> : <Empty title="No new customers" copy="New registrations will appear here for the selected period." /> : data?.visitorsList.length ? <div className="mt-6 max-h-[55vh] divide-y divide-black/[.06] overflow-y-auto dark:divide-white/[.08]">{data.visitorsList.map((visitor) => <button type="button" key={`${visitor.key}-${visitor.lastSeen}`} onClick={() => { setAudiencePopup(null); setSelectedVisitor(visitor); }} className="block w-full py-4 text-left transition hover:bg-[#faf8f4] dark:hover:bg-white/[.03]"><div className="flex items-center justify-between gap-4"><div><p className="text-sm font-medium">{visitor.label}<span className="ml-2 text-[10px] font-normal uppercase tracking-[.12em] text-[#9a7a4d]">{visitor.kind}</span></p><p className="mt-1 text-xs text-[#9298a0]">{visitor.lastPath} · {visitor.views} views · {visitor.source}</p></div><span className="whitespace-nowrap text-[10px] text-[#9298a0]">{visitor.current ? 'Current device' : visitor.active ? 'Live now' : relativeTime(visitor.lastSeen)}</span></div></button>)}</div> : <Empty title="No visitors" copy="Storefront visitors will appear here after they open a page." />}</section></div> : null}
  </div>;
}
