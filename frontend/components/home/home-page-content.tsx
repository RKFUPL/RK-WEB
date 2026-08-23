import { StickyHeader } from './sticky-header';
import { FeaturedCollection } from './featured-collection';
import { ShopCategories } from './shop-categories';
import { FeaturedLooks } from './featured-looks';
import { Services } from './services';
import { Newsletter } from './newsletter';
import { Footer } from './footer';
import { CrestTransition } from './crest-transition';

type HomePageContentProps = {
  ready: boolean;
};

export function HomePageContent({ ready }: HomePageContentProps) {
  return (
    <div className="relative z-10" aria-hidden={!ready}>
      <StickyHeader transparentAtTop />
      <div
        id="home"
        className={`transition-all duration-1000 ${ready ? 'opacity-100 translate-y-0' : 'pointer-events-none opacity-0 translate-y-6'}`}
      >
        <FeaturedCollection />
        <div className="theme-transition-below">
          <ShopCategories />
          <FeaturedLooks />
          <div className="testimonials-newsletter-scene">
            <Services />
            <div className="footer-signature-scene" aria-label="Rashi Kapoor signature artwork">
              <CrestTransition />
            </div>
            <Newsletter />
          </div>
          <Footer />
        </div>
      </div>
    </div>
  );
}
