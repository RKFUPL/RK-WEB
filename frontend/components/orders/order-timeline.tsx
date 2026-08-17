import { Check } from 'lucide-react';
import { fulfillmentSteps, orderDateTime, type Order } from '@/lib/orders';

export function OrderTimeline({ order, compact = false }: { order: Order; compact?: boolean }) {
  const eventByStatus = new Map(order.timeline.map((event) => [event.status, event]));
  const currentIndex = fulfillmentSteps.findIndex((step) => step.status === order.fulfillmentStatus);
  const alternative = ['cancelled', 'return_requested', 'returned', 'refunded'].includes(order.fulfillmentStatus);

  return <div className={compact ? 'space-y-0' : 'space-y-0'}>
    {fulfillmentSteps.map((step, index) => {
      const event = eventByStatus.get(step.status);
      const complete = Boolean(event) || (!alternative && currentIndex > index);
      const current = !alternative && currentIndex === index;
      return <div key={step.status} className="grid grid-cols-[1.75rem_1fr] gap-3">
        <div className="flex flex-col items-center"><span className={`grid h-6 w-6 place-items-center rounded-full border text-[10px] transition ${complete ? 'border-gold bg-gold text-ink' : current ? 'border-gold bg-ivory text-gold' : 'border-black/15 text-transparent dark:border-white/20'}`}>{complete ? <Check size={12} strokeWidth={2} /> : current ? <span className="h-1.5 w-1.5 rounded-full bg-gold" /> : '·'}</span>{index < fulfillmentSteps.length - 1 ? <span className={`min-h-9 w-px flex-1 ${complete ? 'bg-gold/60' : 'bg-black/10 dark:bg-white/15'}`} /> : null}</div>
        <div className={compact ? 'pb-5' : 'pb-7'}><div className="flex flex-wrap items-baseline justify-between gap-2"><p className={`text-xs uppercase tracking-[0.2em] ${complete || current ? 'text-charcoal' : 'text-charcoal/35'}`}>{step.label}</p>{event ? <time className="text-[10px] text-charcoal/45">{orderDateTime(event.timestamp)}</time> : null}</div>{!compact && event?.note ? <p className="mt-2 text-xs leading-6 text-charcoal/55">{event.note}</p> : null}</div>
      </div>;
    })}
    {alternative ? <div className="mt-2 border-l-2 border-gold bg-gold/5 px-5 py-4"><p className="text-[10px] uppercase tracking-[0.22em] text-gold">Current status</p><p className="mt-2 font-display text-2xl">{order.latestStatus?.label || order.fulfillmentStatus.replaceAll('_', ' ')}</p>{order.latestStatus?.note ? <p className="mt-2 text-xs leading-6 text-charcoal/60">{order.latestStatus.note}</p> : null}</div> : null}
  </div>;
}

