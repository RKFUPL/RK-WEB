import Image from 'next/image';

type CollectionCardProps = {
  title: string;
  category: string;
  image: string;
};

const collectionFont: Record<string, string> = {
  Anamika: 'RK Anamika',
  Aakaar: 'RK Campaign',
  Hastakala: 'RK Campaign',
  Inaara: 'RK Campaign',
  Naqab: 'RK Campaign',
  Sandook: 'RK Campaign',
};
const collectionFontSize: Record<string, string> = { Hastakala: '1.45rem' };

export function CollectionCard({ title, category, image }: CollectionCardProps) {
  return (
    <article className="group overflow-hidden border border-black/6 bg-white shadow-luxe">
      <div className="relative aspect-[4/5] overflow-hidden rounded-[14px]">
        <Image
          src={image}
          alt={title}
          fill
          className="collection-card-image object-cover"
          sizes="(max-width: 768px) 100vw, 33vw"
        />
      </div>
      <div className="space-y-2 p-6">
        <p className="text-[0.65rem] uppercase tracking-[0.3em] text-charcoal/50">{category}</p>
        <h3 style={{ fontFamily: collectionFont[title] ?? 'var(--font-aakaar)', fontSize: collectionFontSize[title] }} className="text-3xl text-charcoal">{title}</h3>
      </div>
    </article>
  );
}
