import Image from 'next/image';
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';

type CategoryCardProps = {
  title: string;
  image?: string;
  href?: string;
};

export function CategoryCard({ title, image, href }: CategoryCardProps) {
  const content = (
    <article className="group flex h-full flex-col justify-between border border-black/6 bg-white p-5 transition hover:-translate-y-0.5 hover:shadow-[0_20px_50px_rgba(18,18,18,0.06)]">
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <h3 className="font-display text-3xl text-charcoal">{title}</h3>
        </div>
        <ArrowUpRight className="h-5 w-5 text-charcoal/40 transition group-hover:text-gold" />
      </div>
      <div className="mt-8 aspect-[3/4] overflow-hidden border border-black/8 bg-[linear-gradient(180deg,#f8f6f2_0%,#f1ece3_100%)]">
        {image ? (
          <div className="relative h-full w-full">
            <Image
              src={image}
              alt={title}
              fill
              sizes="(min-width: 1024px) 33vw, (min-width: 768px) 50vw, 100vw"
              className="object-cover object-center transition duration-700 group-hover:scale-[1.03]"
            />
          </div>
        ) : (
          <div className="flex h-full items-center justify-center border border-dashed border-black/10 bg-white/45 text-[0.62rem] uppercase tracking-[0.35em] text-charcoal/35">
            Placeholder Image
          </div>
        )}
      </div>
    </article>
  );

  if (href) {
    return (
      <Link href={href} className="block h-full">
        {content}
      </Link>
    );
  }

  return content;
}
