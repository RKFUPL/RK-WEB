import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { runwayCollections } from '@/lib/home-content';

export function ExclusiveRunway() {
  return (
    <section aria-labelledby="exclusive-runway-title" className="border-y border-gold/25 bg-[#090806] text-[#f3ecdf]">
      <div className="mx-auto w-full max-w-7xl px-6 py-20 lg:px-10 lg:py-28">
        <div className="flex flex-col gap-5 border-b border-gold/25 pb-8 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-[0.6rem] uppercase tracking-[0.42em] text-gold/80">The house on the runway</p>
            <h2 id="exclusive-runway-title" className="mt-4 font-display text-5xl leading-[0.9] text-[#f5efe5] md:text-7xl">Our Exclusive Runway</h2>
          </div>
          <p className="max-w-sm text-sm leading-7 text-[#f5efe5]/52">A singular presentation of movement, craft and couture, reserved for the runway.</p>
        </div>

        <div className="mt-10">
          {runwayCollections.map((collection) => (
            <Link key={collection.name} href={collection.href} className="group grid overflow-hidden border border-gold/25 bg-[#11100d] transition duration-500 hover:border-gold/60 md:grid-cols-[1.18fr_0.82fr]">
              <div className="relative min-h-[27rem] overflow-hidden md:min-h-[36rem]">
                <img src={collection.image} alt={`${collection.name} runway`} className="absolute inset-0 h-full w-full object-cover transition duration-1000 ease-out group-hover:scale-[1.025]" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-black/10" />
              </div>
              <div className="flex min-h-[22rem] flex-col justify-between border-t border-gold/20 p-8 md:min-h-0 md:border-l md:border-t-0 md:p-12 lg:p-16">
                <div>
                  <p className="text-[0.58rem] uppercase tracking-[0.38em] text-gold/75">Runway / 01</p>
                  <h3 className="mt-6 font-display text-5xl leading-[0.88] text-[#f5efe5] md:text-6xl">{collection.name}</h3>
                  <p className="mt-7 max-w-sm text-sm leading-7 text-[#f5efe5]/58">{collection.description}</p>
                </div>
                <span className="mt-12 inline-flex items-center gap-4 text-[0.62rem] uppercase tracking-[0.34em] text-gold transition group-hover:text-[#f5efe5]">View runway <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-2" /></span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
