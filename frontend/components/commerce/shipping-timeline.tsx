import Link from 'next/link';
import { verifiedShippingPolicy, type ShippingTimeline as Timeline } from '@/lib/shipping-timeline';

export function ShippingTimeline({ timeline, compact = false, explainModels = false }: { timeline: Timeline; compact?: boolean; explainModels?: boolean }) {
  return <div className={compact ? 'mt-3 text-xs leading-5 text-charcoal/58 dark:text-white/58' : 'border border-black/10 bg-sand/35 p-4 dark:border-white/15'}>
    <p className={compact ? 'text-[0.56rem] uppercase tracking-[0.18em] text-gold' : 'text-[0.58rem] uppercase tracking-[0.24em] text-gold'}>Shipping &amp; Delivery · {timeline.label}</p>
    <p className={compact ? 'mt-1' : 'mt-2 text-sm leading-6 text-charcoal/65'}>{timeline.detail}</p>
    {explainModels ? <div className="mt-3 border-t border-black/10 pt-3 text-xs leading-5 text-charcoal/58 dark:border-white/15 dark:text-white/58">
      <p><span className="font-medium text-charcoal dark:text-white">{verifiedShippingPolicy.readyToWear.label}:</span> Estimated dispatch in {verifiedShippingPolicy.readyToWear.estimate}.</p>
      <p className="mt-1"><span className="font-medium text-charcoal dark:text-white">{verifiedShippingPolicy.madeToOrder.label}:</span> Estimated production and dispatch in {verifiedShippingPolicy.madeToOrder.estimate}.</p>
      <p className="mt-1">These are estimates, not guaranteed delivery dates. The applicable option is identified above.</p>
    </div> : null}
    <Link href="/shipping-returns" className={compact ? 'mt-1 inline-block border-b border-charcoal/25 text-[0.58rem] uppercase tracking-[0.12em]' : 'mt-3 inline-block border-b border-charcoal/30 pb-0.5 text-[0.6rem] uppercase tracking-[0.16em] transition hover:border-gold hover:text-gold'}>Shipping &amp; Returns</Link>
  </div>;
}
