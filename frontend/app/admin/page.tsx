'use client';

import { BarChart3, Boxes, CreditCard, DollarSign, Eye, Heart, Package, ShoppingBag, Star, Users, Zap } from 'lucide-react';

const metrics = [
  ['Revenue today', '₹0', DollarSign], ['Orders today', '0', ShoppingBag], ['Visitors today', '0', Eye], ['Conversion rate', '0%', Zap],
  ['Low stock alerts', '0', Package], ['New customers', '0', Users], ['Wishlist adds', '0', Heart], ['Average rating', '0', Star],
] as const;

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) { return <section className={`rounded-2xl border border-black/[.06] bg-white p-5 shadow-[0_4px_20px_rgba(25,31,38,.035)] dark:border-white/[.08] dark:bg-[#191a1f] ${className}`}>{children}</section>; }
function Empty({ title, copy }: { title: string; copy: string }) { return <div className="flex min-h-[150px] flex-col items-center justify-center text-center"><BarChart3 size={23} className="text-[#b6bbc1]" /><p className="mt-3 text-sm font-medium">{title}</p><p className="mt-1 max-w-sm text-xs text-[#9298a0]">{copy}</p></div>; }

export default function AdminDashboard() {
  return <div className="space-y-5">
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{metrics.slice(0, 4).map(([label, value, Icon]) => <Card key={label}><span className="grid h-9 w-9 place-items-center rounded-xl bg-[#f4efe7] text-[#9a7a4d]"><Icon size={17} /></span><p className="mt-5 text-xs text-[#8a9098]">{label}</p><p className="mt-1 text-2xl font-semibold tracking-[-.04em]">{value}</p><p className="mt-2 text-[11px] text-[#a2a7ad]">No data yet</p></Card>)}</div>
    <div className="grid gap-5 xl:grid-cols-[1.6fr_1fr]"><Card><div className="flex items-center justify-between"><div><h2 className="text-[15px] font-semibold">Sales performance</h2><p className="mt-1 text-xs text-[#8a9098]">Live data will appear when orders are connected.</p></div><span className="rounded-lg bg-[#f5f6f8] px-3 py-2 text-xs text-[#8a9098] dark:bg-white/[.06]">No period data</span></div><Empty title="No sales data" copy="Connect your order source to populate this chart in real time." /></Card><Card><div className="flex items-center justify-between"><h2 className="text-[15px] font-semibold">Traffic sources</h2><span className="text-xs text-[#8a9098]">0 visitors</span></div><Empty title="No traffic data" copy="Traffic integrations have not recorded any visitors yet." /></Card></div>
    <div className="grid gap-5 xl:grid-cols-[1.35fr_1fr]"><Card><div className="flex items-center justify-between"><h2 className="text-[15px] font-semibold">Best selling products</h2><Boxes size={17} className="text-[#a5abb2]" /></div><Empty title="No products yet" copy="Products will appear here once they are added to the catalog." /></Card><Card><div className="flex items-center justify-between"><h2 className="text-[15px] font-semibold">Live activity</h2><CreditCard size={17} className="text-[#a5abb2]" /></div><Empty title="No activity yet" copy="Orders, stock updates, and other events will appear here." /></Card></div>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{metrics.slice(4).map(([label, value, Icon]) => <Card key={label}><span className="grid h-9 w-9 place-items-center rounded-xl bg-[#f4efe7] text-[#9a7a4d]"><Icon size={17} /></span><p className="mt-4 text-xs text-[#8a9098]">{label}</p><p className="mt-1 text-2xl font-semibold">{value}</p><p className="mt-2 text-[11px] text-[#a2a7ad]">No data yet</p></Card>)}</div>
    <Card className="bg-[#27231f] text-[#f8f3eb] dark:bg-[#302a24]"><h2 className="text-[15px] font-semibold">Insights</h2><p className="mt-1 text-sm text-white/55">Insights will be generated from real store activity.</p><Empty title="No insights yet" copy="There is not enough connected data to make a reliable recommendation." /></Card>
  </div>;
}
