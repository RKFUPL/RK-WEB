'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart3, Boxes, DollarSign, Eye, Heart, Package, ShoppingBag, Star, Users, Zap } from 'lucide-react';
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
    conversionRate: number;
    lowStock: number;
    newCustomers: number;
    wishlistAdds: number;
    averageRating: number;
  };
  sales: Array<{ date: string; orders: number; revenue: number }>;
  trafficSources: Array<{ source: string; visitors: number; views: number }>;
  bestSellingProducts: Array<{ id: string; name: string; units: number; revenue: number }>;
  activity: Array<{ id: string; type: string; label: string; detail: string; createdAt: string | null }>;
};

const currency = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const integer = new Intl.NumberFormat('en-IN');
const periodLabels: Record<Period, string> = { '7d': 'Last 7 days', '30d': 'Last 30 days', '90d': 'Last 90 days' };

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-black/[.06] bg-white p-5 shadow-[0_4px_20px_rgba(25,31,38,.035)] dark:border-white/[.08] dark:bg-[#191a1f] ${className}`}>{children}</section>;
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

  const loadDashboard = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const token = window.localStorage.getItem('rk_access_token') ?? '';
      const response = await fetch(`${apiBaseUrl}/api/admin/dashboard?period=${period}`, {
        headers: { Authorization: `Bearer ${token}` },
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

  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2 text-xs text-[#7d838d]"><span className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_0_4px_rgba(16,185,129,.12)]" />Live backend data · refreshes every 30 seconds</div>
      <div className="flex items-center gap-3"><label htmlFor="dashboard-period" className="text-[10px] uppercase tracking-[.16em] text-[#9298a0]">Period</label><select id="dashboard-period" value={period} onChange={(event) => setPeriod(event.target.value as Period)} className="rounded-lg border border-black/[.08] bg-white px-3 py-2 text-xs outline-none focus:border-[#9a7a4d] dark:border-white/[.1] dark:bg-[#191a1f]">{Object.entries(periodLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
    </div>

    {error ? <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error} Existing values remain visible while the dashboard retries automatically.</div> : null}

    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{metricCards.slice(0, 4).map(([label, value, Icon, detail]) => <Card key={label}><span className="grid h-9 w-9 place-items-center rounded-xl bg-[#f4efe7] text-[#9a7a4d]"><Icon size={17} /></span><p className="mt-5 text-xs text-[#8a9098]">{label}</p><p className="mt-1 text-2xl font-semibold tracking-[-.04em]">{loading && !data ? '…' : value}</p><p className="mt-2 text-[11px] text-[#a2a7ad]">{detail}</p></Card>)}</div>

    <div className="grid gap-5 xl:grid-cols-[1.6fr_1fr]">
      <Card><div className="flex items-center justify-between"><div><h2 className="text-[15px] font-semibold">Sales performance</h2><p className="mt-1 text-xs text-[#8a9098]">Revenue and order volume from the orders collection.</p></div><span className="rounded-lg bg-[#f5f6f8] px-3 py-2 text-xs text-[#8a9098] dark:bg-white/[.06]">{data ? currency.format(data.metrics.revenue) : 'Loading…'}</span></div>{data?.sales.some((point) => point.revenue || point.orders) ? <div className="mt-8 flex h-44 items-end gap-1" aria-label="Sales performance chart">{data.sales.map((point, index) => { const height = Math.max(point.revenue, point.orders) / maxSales * 100; const showLabel = index === 0 || index === data.sales.length - 1 || data.sales.length <= 7; return <div key={point.date} className="group flex min-w-0 flex-1 flex-col items-center justify-end gap-2"><div title={`${point.date}: ${currency.format(point.revenue)}, ${point.orders} orders`} style={{ height: `${Math.max(4, height)}%` }} className="w-full max-w-8 rounded-t bg-[#d9b47b] transition hover:bg-[#9a7a4d]" /><span className="h-3 truncate text-[8px] text-[#9aa0a8]">{showLabel ? point.date.slice(5) : ''}</span></div>; })}</div> : <Empty title="No sales yet" copy="Completed orders will populate this chart automatically." />}</Card>
      <Card><div className="flex items-center justify-between"><h2 className="text-[15px] font-semibold">Traffic sources</h2><span className="text-xs text-[#8a9098]">{metrics ? `${metrics.visitors} visitors` : 'Loading…'}</span></div>{data?.trafficSources.length ? <div className="mt-7 space-y-5">{data.trafficSources.map((source) => <div key={source.source}><div className="mb-2 flex items-center justify-between text-xs"><span className="capitalize">{source.source}</span><span className="text-[#8a9098]">{source.visitors} visitors · {source.views} views</span></div><div className="h-1.5 overflow-hidden rounded-full bg-[#eceef0] dark:bg-white/[.08]"><div className="h-full rounded-full bg-[#9a7a4d]" style={{ width: `${source.visitors / maxTraffic * 100}%` }} /></div></div>)}</div> : <Empty title="No traffic yet" copy="New storefront visits will appear here automatically." />}</Card>
    </div>

    <div className="grid gap-5 xl:grid-cols-[1.35fr_1fr]">
      <Card><div className="flex items-center justify-between"><h2 className="text-[15px] font-semibold">Best selling products</h2><Boxes size={17} className="text-[#a5abb2]" /></div>{data?.bestSellingProducts.length ? <div className="mt-6 divide-y divide-black/[.06] dark:divide-white/[.08]">{data.bestSellingProducts.map((product, index) => <div key={product.id} className="flex items-center gap-4 py-3"><span className="grid h-7 w-7 place-items-center rounded-full bg-[#f4efe7] text-xs text-[#9a7a4d]">{index + 1}</span><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{product.name}</p><p className="mt-1 text-xs text-[#9298a0]">{product.units} units sold</p></div><span className="text-sm">{currency.format(product.revenue)}</span></div>)}</div> : <Empty title="No product sales yet" copy="Products are ranked from real order line items." />}</Card>
      <Card><div className="flex items-center justify-between"><h2 className="text-[15px] font-semibold">Live activity</h2><span className="text-[10px] uppercase tracking-[.14em] text-emerald-600">Live</span></div>{data?.activity.length ? <div className="mt-5 max-h-64 divide-y divide-black/[.06] overflow-y-auto dark:divide-white/[.08]">{data.activity.map((entry) => <div key={`${entry.type}-${entry.id}`} className="flex gap-3 py-3"><span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[#d9b47b]" /><div className="min-w-0 flex-1"><p className="text-xs font-medium">{entry.label}</p><p className="mt-1 truncate text-[11px] text-[#9298a0]">{entry.detail}</p></div><span className="whitespace-nowrap text-[10px] text-[#a2a7ad]">{relativeTime(entry.createdAt)}</span></div>)}</div> : <Empty title="No recent activity" copy="Page views, customer actions, and orders will appear here." />}</Card>
    </div>

    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{metricCards.slice(4).map(([label, value, Icon, detail]) => <Card key={label}><span className="grid h-9 w-9 place-items-center rounded-xl bg-[#f4efe7] text-[#9a7a4d]"><Icon size={17} /></span><p className="mt-4 text-xs text-[#8a9098]">{label}</p><p className="mt-1 text-2xl font-semibold">{loading && !data ? '…' : value}</p><p className="mt-2 text-[11px] text-[#a2a7ad]">{detail}</p></Card>)}</div>

    <Card className="bg-[#27231f] text-[#f8f3eb] dark:bg-[#302a24]"><h2 className="text-[15px] font-semibold">Data coverage</h2><p className="mt-2 text-sm leading-6 text-white/60">Traffic is collected from storefront page views. Revenue, orders, best sellers, stock, customers, wishlists, and ratings are calculated from their corresponding backend records and events—no dashboard value is hardcoded.</p>{data ? <p className="mt-3 text-[10px] uppercase tracking-[.16em] text-white/35">Last updated {new Date(data.generatedAt).toLocaleTimeString()}</p> : null}</Card>
  </div>;
}
