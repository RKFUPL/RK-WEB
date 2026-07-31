import { testimonials } from '@/lib/home-content';
import { SectionShell } from './section-shell';

export function Services() {
  return (
    <SectionShell id="services" className="bg-ivory">
      <div className="max-w-2xl space-y-4">
        <p className="text-xs uppercase tracking-[0.38em] text-charcoal/50">Our testimonials</p>
        <h2 className="font-display text-4xl leading-none text-charcoal md:text-6xl">
          Words from the women who wear our collection.
        </h2>
      </div>
      <div className="mt-10 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {testimonials.map((testimonial, index) => (
          <article
            key={`${testimonial.name}-${index}`}
            className="border border-black/6 bg-white p-6 shadow-[0_12px_28px_rgba(18,18,18,0.04)]"
          >
            <p className="text-[0.65rem] uppercase tracking-[0.35em] text-charcoal/35">
              Testimonial 0{index + 1}
            </p>
            <h3 className="mt-4 font-display text-2xl leading-tight text-charcoal md:text-3xl">
              “{testimonial.quote}”
            </h3>
            <div className="mt-6">
              <p className="text-sm uppercase tracking-[0.28em] text-charcoal/80">
                {testimonial.name}
              </p>
              <p className="mt-1 text-xs uppercase tracking-[0.28em] text-charcoal/35">
                {testimonial.role}
              </p>
            </div>
          </article>
        ))}
      </div>
    </SectionShell>
  );
}
