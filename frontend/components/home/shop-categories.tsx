import { categoryItems } from '@/lib/home-content';
import { SectionShell } from './section-shell';
import { CategoryCard } from './category-card';

function chunkIntoRows<T>(items: readonly T[], size: number) {
  const rows: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    rows.push(items.slice(index, index + size));
  }

  return rows;
}

export function ShopCategories() {
  const rows = chunkIntoRows(categoryItems, 3);

  return (
    <SectionShell id="shop" className="bg-ivory">
      <div className="max-w-2xl space-y-4">
        <p className="text-xs uppercase tracking-[0.38em] text-charcoal/50">Browse</p>
        <h2 className="font-display text-4xl leading-none text-charcoal md:text-6xl">
          Drape yourself in the luxury of
        </h2>
      </div>
      <div className="mt-10 space-y-5">
        {rows.map((row, rowIndex) => {
          let rowClassName = 'grid gap-5';

          if (row.length === 3) {
            rowClassName += ' md:grid-cols-3';
          } else if (row.length === 2) {
            rowClassName += ' md:grid-cols-2 md:max-w-4xl md:mx-auto';
          } else {
            rowClassName += ' md:max-w-[26rem] md:mx-auto';
          }

          return (
              <div key={`${rowIndex}-${row.length}`} className={rowClassName}>
              {row.map((item) => (
                <CategoryCard key={item.title} title={item.title} image={item.image} href={item.href} />
              ))}
            </div>
          );
        })}
      </div>
    </SectionShell>
  );
}
