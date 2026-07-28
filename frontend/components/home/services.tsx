import { services } from '@/lib/home-content';
import { SectionShell } from './section-shell';

export function Services() {
  return (
    <SectionShell id="services" className="bg-ivory">
      <div className="max-w-2xl space-y-4">
        <p className="text-xs uppercase tracking-[0.38em] text-charcoal/50">Services</p>
        <h2 className="font-display text-4xl leading-none text-charcoal md:text-6xl">
          Elevated service designed around the client.
        </h2>
      </div>
      <div className="mt-10 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {services.map((service, index) => (
          <article key={service} className="border border-black/6 bg-white p-6 shadow-[0_12px_28px_rgba(18,18,18,0.04)]">
            <p className="text-[0.65rem] uppercase tracking-[0.35em] text-charcoal/35">
              Service 0{index + 1}
            </p>
            <h3 className="mt-4 font-display text-3xl text-charcoal">{service}</h3>
          </article>
        ))}
      </div>
    </SectionShell>
  );
}
