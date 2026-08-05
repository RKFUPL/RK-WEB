import Link from 'next/link';

export default function AdminDashboard() {
  return <div className="mt-12 grid gap-4 md:grid-cols-3"><Link href="/admin/users" className="border border-black/10 bg-white p-6 transition hover:border-gold hover:shadow-sm">Users & roles<br /><span className="mt-3 block text-sm text-charcoal/55">Manage access with audit history.</span></Link><Link href="/admin/orders" className="border border-black/10 bg-white p-6 transition hover:border-gold hover:shadow-sm">Commerce<br /><span className="mt-3 block text-sm text-charcoal/55">Orders, refunds, coupons and content.</span></Link><Link href="/admin/reports" className="border border-black/10 bg-white p-6 transition hover:border-gold hover:shadow-sm">Reports<br /><span className="mt-3 block text-sm text-charcoal/55">Analytics and site configuration.</span></Link></div>;
}
