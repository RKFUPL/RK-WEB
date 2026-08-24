import type { CollectionHeroConfig } from '@/lib/catalog';

type CategoryItem = {
  title: string;
  image?: string;
  href?: string;
  comingSoon?: boolean;
};

export type CollectionPageHero = Partial<CollectionHeroConfig> & Pick<CollectionHeroConfig, 'image'>;

export type CollectionPage = {
  name: string;
  route: string;
  status: string;
  summary: string;
  image: string;
  hero?: CollectionPageHero;
  /** Add the Cloudinary or local font URL here when each collection font is ready. */
  fontFamily: string;
  fontUrl?: string;
};

export const collectionOrder = ['aakaar', 'hastakala', 'inaara', 'anamika', 'naqab', 'sandook'] as const;

const collectionRank = new Map<string, number>(collectionOrder.map((name, index) => [name, index]));

export function sortByCollectionOrder<T>(items: readonly T[], getName: (item: T) => string) {
  return [...items].sort((left, right) => {
    const leftRank = collectionRank.get(getName(left).trim().toLowerCase()) ?? collectionOrder.length;
    const rightRank = collectionRank.get(getName(right).trim().toLowerCase()) ?? collectionOrder.length;
    return leftRank - rightRank;
  });
}

export const espirituLibreImageUrl = 'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785861902/Espi_bbvgfh.png';

export const homepageHeroVideoUrl = 'https://video.wixstatic.com/video/afed36_dd09f4e15eed449c81c98f3609180b91/1080p/mp4/file.mp4';
export const runwayHeroVideoUrl = 'https://video.wixstatic.com/video/afed36_2e5b8660523d4d1eaaac8173ecd89d8f/720p/mp4/file.mp4';

export const lookbookUrls = {
  Anamika: 'https://lookbookmaker.onrender.com/catalog/anamika-lookbook?page=1',
  Espiritu: 'https://lookbookmaker.onrender.com/catalog/espi?page=1',
  Sandook: 'https://lookbookmaker.onrender.com/catalog/sandook',
  Inaara: 'https://lookbookmaker.onrender.com/catalog/inaara',
  Hastakala: 'https://lookbookmaker.onrender.com/catalog/hastakala',
} as const;

export const runwayCollections = [
  {
    id: 'espiritu-libre',
    name: 'Espiritu Libre @LFW',
    status: 'coming-soon',
    image: espirituLibreImageUrl,
    href: '/runway',
    editorialHref: lookbookUrls.Espiritu,
    description: 'A free-spirited runway chapter shaped by movement, fluid drape, and modern Indian couture.',
  },
] as const;

export const brandLogoUrl = 'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785305776/RK_LOGOMARK_t6untf.svg';
export const footerSignatureLightImage = 'https://res.cloudinary.com/fm1bwbrd/image/upload/v1787402759/Rashi_Kapoor_Legacy_Crest_Transparent_kbljbo.png';
export const footerSignatureDarkImage = 'https://res.cloudinary.com/fm1bwbrd/image/upload/v1787059406/3c335991-6978-462c-a561-b3d1a23e11a0.png';
export const aakarBannerBackgroundUrl = 'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785305719/BG_xsyd8f.png';
// Keep this as a normal HTML5 video URL. Cloudinary handles the delivery
// format/quality negotiation while the poster in the consuming component
// remains the reliable first-paint fallback.
export const storeInteriorVideoUrl = 'https://res.cloudinary.com/fm1bwbrd/video/upload/f_auto,q_auto,w_1920/v1785305865/39_-_RK_Kalkatta_Interior_ivhomn.mp4';

export const homeNavigation = [
  'Home',
  'Collections',
  'Lookbook',
  'Runway',
  'About',
  'Contact',
] as const;

export const featuredCollection = {
  title: 'AAKAAR',
  description:
    'A refined debut collection shaped by fluid tailoring, sculpted silhouettes, and understated couture details.',
  image: 'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785487885/Rashi_Kapoor1358_compressed_8000kb_1_iblkxd.jpg',
  cta: 'Browse the Collection',
};

export const featuredCollectionFrames = [
  'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785488046/Rashi_Kapoor474_compressed_8000kb_pqcair.jpg',
  'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785487885/Rashi_Kapoor1358_compressed_8000kb_1_iblkxd.jpg',
  'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785487994/Rashi_Kapoor2418_compressed_8000kb_qkke56.jpg',
  'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785488013/Rashi_Kapoor306_compressed_8000kb_vnw8a0.jpg',
  'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785487943/Rashi_Kapoor187_compressed_8000kb_e5k7xn.jpg',
] as const;

const collectionPagesUnordered: readonly CollectionPage[] = [
  {
    name: 'Anamika',
    route: '/collections/collections-of-anamika',
    status: 'Collection',
    summary: 'A refined story shaped by movement, texture, and modern occasion dressing.',
    image: 'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785305156/Rashi_Kapoor3092_stukqt.jpg',
    hero: {
      type: 'image',
      image: 'https://res.cloudinary.com/fm1bwbrd/image/upload/v1786735678/Rashi_Kapoor2571_otpcmv.jpg',
      desktopObjectPosition: 'center 52%',
      mobileObjectPosition: '58% center',
      textPosition: 'left',
      textTheme: 'light',
      titleScale: 'feature',
    },
    fontFamily: 'RK Anamika',
    fontUrl: 'https://res.cloudinary.com/fm1bwbrd/raw/upload/v1786736339/monbaiti_e9gt43.ttf',
  },
  {
    name: 'Hastakala',
    route: '/collections/collections-of-hasthkala',
    status: 'Collection',
    summary: 'Craft-led silhouettes with a more artisanal, hand-finished mood.',
    image: 'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785304857/Hasthkalare_hhljut.jpg',
    hero: {
      type: 'image',
      image: 'https://res.cloudinary.com/fm1bwbrd/image/upload/v1786735890/img-2026-03-04-18-30-01_rfu8cp.png',
      desktopObjectPosition: '58% 38%',
      mobileObjectPosition: '64% 32%',
      textPosition: 'left',
      textTheme: 'light',
      titleScale: 'standard',
    },
    fontFamily: 'RK Campaign',
    fontUrl: 'https://res.cloudinary.com/fm1bwbrd/raw/upload/v1786736151/TAN-MON_CHERI-Regular_w92ze1.otf',
  },
  {
    name: 'Inaara',
    route: '/collections/collections-of-inaara',
    status: 'Collection',
    summary: 'A luminous edit with fluid lines and softer, celebratory energy.',
    image: 'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785305219/RASHI_KAPOOR_-_27-3-240879_xr10ue.jpg',
    hero: {
      type: 'image',
      image: 'https://res.cloudinary.com/fm1bwbrd/image/upload/v1786735531/e9a9f2bc-2acc-4b60-b3e4-b68c9a08eae1.png',
      desktopObjectPosition: 'center 28%',
      mobileObjectPosition: '58% 30%',
      textPosition: 'left',
      textTheme: 'light',
      titleScale: 'standard',
    },
    fontFamily: 'RK Campaign',
    fontUrl: 'https://res.cloudinary.com/fm1bwbrd/raw/upload/v1786736151/TAN-MON_CHERI-Regular_w92ze1.otf',
  },
  {
    name: 'Naqab',
    route: '/collections/collections-of-naqab',
    status: 'Collection',
    summary: 'A more dramatic chapter built around veiled layers and evening presence.',
    image: 'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785304902/Naqab_2_re_qdu1xs.jpg',
    hero: {
      type: 'image',
      image: 'https://res.cloudinary.com/fm1bwbrd/image/upload/v1786735768/RASHI_KAPOOR_04-07-20224740_dl6wvx.webp',
      desktopObjectPosition: '56% 38%',
      mobileObjectPosition: '62% 32%',
      textPosition: 'left',
      textTheme: 'light',
      titleScale: 'standard',
    },
    fontFamily: 'RK Campaign',
    fontUrl: 'https://res.cloudinary.com/fm1bwbrd/raw/upload/v1786736151/TAN-MON_CHERI-Regular_w92ze1.otf',
  },
  {
    name: 'Sandook',
    route: '/collections/collections-of-sandook',
    status: 'Collection',
    summary: 'A heritage-leaning story with a more treasured, heirloom-like mood.',
    image: 'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785305276/Rashi_Kapoor_22-03-20220063_nwo7of.jpg',
    hero: {
      type: 'image',
      image: 'https://res.cloudinary.com/fm1bwbrd/image/upload/v1786735823/5d8246f4-360b-45d5-8d43-25eb717fbdfd.png',
      desktopObjectPosition: '58% 44%',
      mobileObjectPosition: '62% 42%',
      textPosition: 'left',
      textTheme: 'dark',
      titleScale: 'standard',
    },
    fontFamily: 'RK Campaign',
    fontUrl: 'https://res.cloudinary.com/fm1bwbrd/raw/upload/v1786736151/TAN-MON_CHERI-Regular_w92ze1.otf',
  },
] as const;

export const collectionPages: readonly CollectionPage[] = sortByCollectionOrder(collectionPagesUnordered, (collection) => collection.name);

/** The coming-soon Aakaar card is intentionally a gallery-only entry. */
export const collectionGalleryPages: readonly (CollectionPage & { comingSoon?: boolean })[] = sortByCollectionOrder([
  {
    name: 'Aakaar',
    route: '/aakaar',
    status: 'Coming Soon',
    summary: featuredCollection.description,
    image: 'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785487885/Rashi_Kapoor1358_compressed_8000kb_1_iblkxd.jpg',
    fontFamily: 'RK Campaign',
    fontUrl: 'https://res.cloudinary.com/fm1bwbrd/raw/upload/v1786736151/TAN-MON_CHERI-Regular_w92ze1.otf',
    comingSoon: true,
  },
  ...collectionPages,
], (collection) => collection.name);

export const searchItems = [
  ...collectionGalleryPages.map((collection) => ({
    title: collection.name,
    type: 'Collection',
    href: collection.route,
    keywords: `${collection.name} ${collection.summary}`,
  })),
  { title: 'All Collections', type: 'Collection', href: '/collections', keywords: 'collections archive' },
  { title: 'All Lookbooks', type: 'Lookbook', href: '/rk-lookbooks', keywords: 'lookbook editorial' },
  { title: 'Runway', type: 'Page', href: '/runway', keywords: 'runway Espiritu Libre editorial' },
  { title: 'About Rashi Kapoor', type: 'Page', href: '/about', keywords: 'about house story designer' },
] as const;

export const categoryItems: readonly CategoryItem[] = collectionGalleryPages.map((collection) => ({
  title: collection.name,
  image: collection.image,
  href: lookbookUrls[collection.name as keyof typeof lookbookUrls] ?? collection.route,
  comingSoon: collection.comingSoon,
}));

export const featuredLooks = [
  {
    title: 'Look 01',
    caption: 'Hand-finished drape, softened tailoring',
    image: 'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785488046/Rashi_Kapoor474_compressed_8000kb_pqcair.jpg',
    span: 'lg:col-span-5 lg:row-span-2',
  },
  {
    title: 'Look 02',
    caption: 'Editorial layering with couture lines',
    image: 'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785487885/Rashi_Kapoor1358_compressed_8000kb_1_iblkxd.jpg',
    span: 'lg:col-span-3',
  },
  {
    title: 'Look 03',
    caption: 'Occasionwear with sculpted volume',
    image: 'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785487994/Rashi_Kapoor2418_compressed_8000kb_qkke56.jpg',
    span: 'lg:col-span-4',
  },
  {
    title: 'Look 04',
    caption: 'Bridal motion, quiet opulence',
    image: 'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785488013/Rashi_Kapoor306_compressed_8000kb_vnw8a0.jpg',
    span: 'lg:col-span-4',
  },
  {
    title: 'Look 05',
    caption: 'Resort ease in a luxury frame',
    image: 'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785487943/Rashi_Kapoor187_compressed_8000kb_e5k7xn.jpg',
    span: 'lg:col-span-8',
  },
] as const;

export const lookbookCovers = sortByCollectionOrder([
  {
    title: 'Aakaar',
    image: featuredCollection.image,
    href: '/rk-lookbooks',
    caption: 'The debut chapter is arriving soon.',
    span: 'lg:col-span-4',
    comingSoon: true,
  },
  {
    title: 'Hastakala',
    image: 'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785862112/Hastakala_kcb6la.png',
    href: lookbookUrls.Hastakala,
    caption: 'A craft-first visual story.',
    span: 'lg:col-span-3',
  },
  {
    title: 'Inaara',
    image: 'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785861901/Inaara_hn30rg.png',
    href: lookbookUrls.Inaara,
    caption: 'A luminous, celebratory edit.',
    span: 'lg:col-span-8',
  },
  {
    title: 'Anamika',
    image: 'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785861902/Anamika_ojeh19.png',
    href: lookbookUrls.Anamika,
    caption: 'A softer, movement-led chapter.',
    span: 'lg:col-span-5 lg:row-span-2',
  },
  {
    title: 'Naqab',
    image: 'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785304902/Naqab_2_re_qdu1xs.jpg',
    href: '/rk-lookbooks/naqab',
    caption: 'A veiled, cinematic chapter.',
    span: 'lg:col-span-4',
  },
  {
    title: 'Sandook',
    image: 'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785861901/Sandook_h0rfqg.png',
    href: lookbookUrls.Sandook,
    caption: 'A treasured archive of the house.',
    span: 'lg:col-span-4',
  },
], (lookbook) => lookbook.title);

export const brandStory = {
  title: 'The House of Rashi Kapoor',
  description:
    'Luxury womenswear rooted in craftsmanship, modern Indian occasion dressing, and a cinematic visual language designed to feel timeless.',
  image: 'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785487885/Rashi_Kapoor1358_compressed_8000kb_1_iblkxd.jpg',
  cta: 'Read More',
};

export const testimonials = [
  {
    quote: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Integer vitae justo eget magna.',
    name: 'Ananya S.',
    role: 'Client',
  },
  {
    quote: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt.',
    name: 'Meher K.',
    role: 'Client',
  },
  {
    quote: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Ut enim ad minim veniam quis.',
    name: 'Ritika P.',
    role: 'Client',
  },
  {
    quote: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis aute irure dolor in.',
    name: 'Naina V.',
    role: 'Client',
  },
  {
    quote: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Excepteur sint occaecat cupidatat.',
    name: 'Sana M.',
    role: 'Client',
  },
  {
    quote: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nunc dignissim, massa at.',
    name: 'Diya R.',
    role: 'Client',
  },
] as const;

export const instagramItems = [
  'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785488046/Rashi_Kapoor474_compressed_8000kb_pqcair.jpg',
  'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785487885/Rashi_Kapoor1358_compressed_8000kb_1_iblkxd.jpg',
  'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785487994/Rashi_Kapoor2418_compressed_8000kb_qkke56.jpg',
  'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785488013/Rashi_Kapoor306_compressed_8000kb_vnw8a0.jpg',
  'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785487943/Rashi_Kapoor187_compressed_8000kb_e5k7xn.jpg',
  'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785488046/Rashi_Kapoor474_compressed_8000kb_pqcair.jpg',
] as const;
