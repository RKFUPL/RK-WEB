import { brandLogoUrl, categoryItems } from '@/lib/home-content';
import { CategoryCard } from './category-card';

export function ShopCategories() {
  return (
    <section id="shop" className="shop-categories-section bg-ivory">
      <img
        src="https://res.cloudinary.com/fm1bwbrd/image/upload/v1785921051/7438eb66-a217-4bdd-9227-92112a02fc5c_hds45c.png"
        alt=""
        aria-hidden="true"
        className="shop-section-backdrop shop-section-backdrop-light"
      />
      <img
        src="https://res.cloudinary.com/fm1bwbrd/image/upload/v1785920821/download_trvdb5.png"
        alt=""
        aria-hidden="true"
        className="shop-section-backdrop shop-section-backdrop-dark"
      />

      <div className="relative z-10 mx-auto w-full max-w-[78rem] px-6 py-16 lg:px-10 lg:py-16">
        <div className="grid items-center gap-12 lg:grid-cols-[minmax(15rem,0.76fr)_minmax(0,1.24fr)] lg:gap-16">
          <div className="max-w-[21rem] space-y-6">
            <div className="flex items-center gap-4">
              <p className="text-[0.62rem] uppercase tracking-[0.38em] text-gold">All collections</p>
              <span className="h-px w-12 bg-gold/65" />
            </div>
            <h2 className="font-display text-[clamp(2.8rem,4.4vw,4.5rem)] leading-[0.94] tracking-[-0.035em] text-charcoal">
              Drape yourself in<br />the luxury of the<br /><span className="inline-flex items-baseline gap-[0.14em]"><img src={brandLogoUrl} alt="RK" className="rk-logo inline-block h-[0.72em] w-auto translate-y-[0.06em] object-contain" /> house.</span>
            </h2>
            <div className="flex items-center gap-3 text-gold" aria-hidden="true">
              <span className="h-px w-5 bg-gold/70" /><span className="text-base">✦</span><span className="h-px w-5 bg-gold/70" />
            </div>
            <p className="max-w-[19rem] text-sm leading-6 text-charcoal/68">
              A curated expression of our design philosophy. Each collection is a story woven in fabric, texture and craftsmanship, with its own palette, proportion, and distinct editorial point of view.
            </p>
            <a href="/collections" className="inline-flex items-center gap-5 border border-gold/65 px-5 py-3 text-[0.6rem] uppercase tracking-[0.27em] text-charcoal transition duration-300 hover:bg-gold hover:text-ink">
              View all collections <span className="text-base leading-none">→</span>
            </a>
          </div>

          <div className="collection-editorial-grid grid w-full max-w-[44rem] grid-cols-2 gap-4 sm:grid-cols-3 lg:justify-self-end">
            {categoryItems.map((item, index) => (
              <CategoryCard key={item.title} title={item.title} image={item.image} href={item.href} index={index} comingSoon={item.comingSoon} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
