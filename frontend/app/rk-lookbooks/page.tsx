import Link from 'next/link';
import { Footer } from '@/components/home/footer';
import { StickyHeader } from '@/components/home/sticky-header';
import { SectionShell } from '@/components/home/section-shell';

const lookbooks: Array<{
  title: string;
  subtitle: string;
  description: string;
  href?: string;
}> = [
  {
    title: 'AAKAAR',
    subtitle: 'The debut moodboard of the house.',
    description: 'Editorial frames, campaign stills, and collection notes gathered into one visual archive.',
  },
  {
    title: 'ANAMIKA',
    subtitle: 'A softer, more movement-led chapter.',
    description: 'An evolving lookbook space for future drops, references, and campaign imagery.',
  },
  {
    title: 'HASTHKALA',
    subtitle: 'A craft-first presentation.',
    description: 'Reserved for hand-finished stories, artisan detail, and heirloom-inspired styling.',
    href: '/rk-lookbooks/hasthkala',
  },
];

export default function RkLookbooksPage() {
  return (
    <main className="bg-ivory text-charcoal">
      <StickyHeader />

      <SectionShell className="pb-16 pt-28 lg:pb-24 lg:pt-32">
        <div className="grid gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
          <div className="space-y-6 lg:sticky lg:top-28 lg:self-start">
            <p className="text-xs uppercase tracking-[0.38em] text-charcoal/45">RK Lookbooks</p>
            <h1 className="max-w-xl font-display text-5xl leading-none md:text-7xl">
              An editorial archive of the house.
            </h1>
            <p className="max-w-xl text-base leading-8 text-charcoal/70 md:text-lg">
              A dedicated page for future lookbooks, campaign selections, and visual references.
              We can keep expanding this into a proper archive as the collections grow.
            </p>
          </div>

          <div className="border-t border-black/10">
            {lookbooks.map((lookbook) => (
              <Link
                key={lookbook.title}
                href={lookbook.href ?? '/rk-lookbooks'}
                target={lookbook.href ? '_blank' : undefined}
                rel={lookbook.href ? 'noopener noreferrer' : undefined}
                className="block border-b border-black/10 py-7 transition duration-300 hover:bg-black/[0.03]"
              >
                <p className="text-[0.63rem] uppercase tracking-[0.35em] text-charcoal/40">
                  Lookbook
                </p>
                <h2 className="mt-2 font-aakaar text-[clamp(2.2rem,7vw,4.6rem)] leading-[0.85] tracking-[0.04em] text-charcoal">
                  {lookbook.title}
                </h2>
                <p className="mt-2 text-sm uppercase tracking-[0.3em] text-charcoal/55">
                  {lookbook.subtitle}
                </p>
                <p className="mt-3 max-w-xl text-sm leading-6 text-charcoal/62 md:text-base md:leading-7">
                  {lookbook.description}
                </p>
              </Link>
            ))}
          </div>
        </div>
      </SectionShell>

      <Footer />
    </main>
  );
}
