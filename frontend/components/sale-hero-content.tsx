import Link from 'next/link';

export function SaleHeroContent({title, subtitle, date, timezone = 'Asia/Kolkata', upcoming = false, ctaLabel, ctaDestination}: {
  title: string; subtitle?: string; date: string; timezone?: string; upcoming?: boolean; ctaLabel?: string; ctaDestination?: string;
}) {
  const formattedDate = new Intl.DateTimeFormat('en-IN', {
    timeZone: timezone, day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  }).format(new Date(date));
  return <div data-testid="sale-hero-content" className="pointer-events-none absolute inset-0 flex items-end bg-gradient-to-t from-black/45 via-transparent to-transparent text-ivory">
    <div className={`w-full px-4 py-3 [text-shadow:0_1px_8px_rgb(0_0_0/35%)] sm:px-8 sm:py-6 lg:px-14 lg:py-12 ${upcoming ? 'flex h-full flex-col justify-between' : ''}`}>
      <h1 className={`max-w-3xl font-display leading-none ${upcoming ? 'text-[clamp(1.25rem,3vw,3rem)]' : 'text-[clamp(1.25rem,4vw,4.5rem)]'}`}>{title}</h1>
      <div>
      {subtitle && <p className="mt-1 max-w-xl text-[11px] leading-snug sm:mt-3 sm:text-sm md:text-base">{subtitle}</p>}
      <p className="mt-1 text-[10px] leading-snug text-ivory/90 sm:mt-3 sm:text-xs">{upcoming ? 'Launches' : 'Ends'} {formattedDate}</p>
      {ctaLabel?.trim() && ctaDestination?.trim() && <Link href={ctaDestination} className="pointer-events-auto mt-2 inline-flex border border-ivory/65 px-3 py-1 text-[10px] uppercase tracking-[.15em] transition hover:bg-ivory hover:text-charcoal focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold sm:mt-5 sm:px-6 sm:py-3 sm:text-xs">{ctaLabel}</Link>}
      </div>
    </div>
  </div>;
}
