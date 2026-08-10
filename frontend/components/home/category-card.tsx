import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';

type CategoryCardProps = {
  title: string;
  image?: string;
  href?: string;
  index?: number;
};

const categoryFont: Record<string, string> = {
  Anamika: 'RK Anamika',
  Hastakala: 'RK Hastakala',
  Inaara: 'RK Inaara',
  Sandook: 'RK Sandook',
};

const categoryFontSize: Record<string, string> = { Hastakala: '1.15rem' };

const categoryObjectPosition: Record<string, string> = {
  Aakaar: 'center 32%',
  Anamika: 'center 42%',
  Hastakala: 'center 38%',
  Inaara: 'center 36%',
  Naqab: 'center 34%',
  Sandook: 'center 45%',
};

export function CategoryCard({ title, image, href, index = 0 }: CategoryCardProps) {
  const content = (
    <article className={`theme-card collection-editorial-card collection-editorial-card-${index} group relative h-full border border-black/12 bg-white/80 p-2 backdrop-blur-[2px] transition duration-500 hover:border-gold/65`}>
      <div className="relative z-10 flex min-h-8 items-center justify-between px-1">
        <h3
          style={{ fontFamily: categoryFont[title] ?? 'var(--font-aakaar)', fontSize: categoryFontSize[title] }}
          className="text-[1.22rem] leading-none text-charcoal"
        >
          {title}
        </h3>
        <ArrowUpRight className="h-4 w-4 text-charcoal/45 transition duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-gold" />
      </div>

      <div className="collection-editorial-card-image relative mt-1 aspect-[4/5] overflow-hidden bg-[linear-gradient(180deg,#f8f6f2_0%,#f1ece3_100%)]">
        {image ? (
          <img
            src={image}
            alt={title}
            style={{ objectPosition: categoryObjectPosition[title] ?? 'center center' }}
            loading={index < 3 ? 'eager' : 'lazy'}
            decoding="async"
            className="block h-full w-full object-cover transition duration-700 ease-out group-hover:scale-[1.025]"
          />
        ) : (
          <div className="flex h-full items-center justify-center border border-dashed border-black/10 bg-white/45 text-[0.62rem] uppercase tracking-[0.35em] text-charcoal/35">
            Placeholder Image
          </div>
        )}
      </div>
    </article>
  );

  return href ? <Link href={href} className="block h-full">{content}</Link> : content;
}
