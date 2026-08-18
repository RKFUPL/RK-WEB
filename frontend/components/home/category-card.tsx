import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';

type CategoryCardProps = {
  title: string;
  image?: string;
  href?: string;
  index?: number;
  comingSoon?: boolean;
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

export function CategoryCard({ title, image, href, index = 0, comingSoon = false }: CategoryCardProps) {
  const content = (
    <article className={`theme-card collection-editorial-card collection-editorial-card-${index} group relative aspect-[4/5] h-full overflow-hidden rounded-[14px] border border-black/12 bg-[linear-gradient(180deg,#f8f6f2_0%,#f1ece3_100%)] backdrop-blur-[2px] transition duration-500 hover:border-gold/65`}>
      <div className="collection-editorial-card-image absolute inset-0 overflow-hidden rounded-[14px] bg-[linear-gradient(180deg,#f8f6f2_0%,#f1ece3_100%)]">
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
        <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/10 to-transparent opacity-90" />
        {comingSoon ? <div className="absolute inset-0 grid place-items-center bg-black/12"><span className="px-4 py-3 text-center text-[0.55rem] uppercase tracking-[0.34em] text-white drop-shadow-[0_1px_10px_rgba(0,0,0,.7)]">Coming<br />Soon</span></div> : null}
      </div>

      <div className="absolute inset-x-0 bottom-0 z-10 flex items-end justify-between gap-3 p-4 text-white sm:p-5">
        <div className="min-w-0">
          <p className="text-[0.48rem] uppercase tracking-[0.28em] text-white/70">Collection</p>
          <h3
            style={{ fontFamily: categoryFont[title] ?? 'var(--font-aakaar)', fontSize: categoryFontSize[title] }}
            className="mt-2 truncate text-[1.35rem] leading-none drop-shadow-[0_1px_8px_rgba(0,0,0,.65)] sm:text-[1.5rem]"
          >
            {title}
          </h3>
        </div>
        <ArrowUpRight className="h-4 w-4 shrink-0 text-white/75 transition duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-gold" />
      </div>
    </article>
  );

  return href ? <Link href={href} className="block h-full">{content}</Link> : content;
}
