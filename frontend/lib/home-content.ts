type CategoryItem = {
  title: string;
  image?: string;
  href?: string;
};

export type CollectionPage = {
  name: string;
  route: string;
  status: string;
  summary: string;
  image: string;
  /** Add the Cloudinary or local font URL here when each collection font is ready. */
  fontFamily: string;
  fontUrl?: string;
};

export const brandLogoUrl = 'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785305776/RK_LOGOMARK_t6untf.svg';
export const aakarBannerBackgroundUrl = 'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785305719/BG_xsyd8f.png';
export const storeInteriorVideoUrl = 'https://res.cloudinary.com/fm1bwbrd/video/upload/v1785305865/39_-_RK_Kalkatta_Interior_ivhomn.mp4';

export const homeNavigation = [
  'Home',
  'Collections',
  'Lookbook',
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

export const collectionPages: readonly CollectionPage[] = [
  {
    name: 'Aakaar',
    route: '/collections/aakaar-insights',
    status: 'Coming Soon',
    summary: 'The debut collection, defined by sculpted drapes and quiet couture detailing.',
    image: 'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785304593/Rashi_Kapoor1351_xzrpyx.jpg',
    fontFamily: 'HV Muse',
  },
  {
    name: 'Anamika',
    route: '/collections/collections-of-anamika',
    status: 'Collection',
    summary: 'A refined story shaped by movement, texture, and modern occasion dressing.',
    image: 'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785305156/Rashi_Kapoor3092_stukqt.jpg',
    fontFamily: 'RK Anamika',
    fontUrl: 'https://res.cloudinary.com/fm1bwbrd/raw/upload/v1785840322/agilera_ucynmn.otf',
  },
  {
    name: 'Hastakala',
    route: '/collections/collections-of-hasthkala',
    status: 'Collection',
    summary: 'Craft-led silhouettes with a more artisanal, hand-finished mood.',
    image: 'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785304857/Hasthkalare_hhljut.jpg',
    fontFamily: 'RK Hastakala',
    fontUrl: 'https://res.cloudinary.com/fm1bwbrd/raw/upload/v1785840581/aesterapersonaluse-0vg2v_jcafbr.ttf',
  },
  {
    name: 'Inaara',
    route: '/collections/collections-of-inaara',
    status: 'Collection',
    summary: 'A luminous edit with fluid lines and softer, celebratory energy.',
    image: 'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785305219/RASHI_KAPOOR_-_27-3-240879_xr10ue.jpg',
    fontFamily: 'RK Inaara',
    fontUrl: 'https://res.cloudinary.com/fm1bwbrd/raw/upload/v1785863506/CormorantInfant-Regular_rsu66v.ttf',
  },
  {
    name: 'Naqab',
    route: '/collections/collections-of-naqab',
    status: 'Collection',
    summary: 'A more dramatic chapter built around veiled layers and evening presence.',
    image: 'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785304902/Naqab_2_re_qdu1xs.jpg',
    fontFamily: 'HV Muse',
  },
  {
    name: 'Sandook',
    route: '/collections/collections-of-sandook',
    status: 'Collection',
    summary: 'A heritage-leaning story with a more treasured, heirloom-like mood.',
    image: 'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785305276/Rashi_Kapoor_22-03-20220063_nwo7of.jpg',
    fontFamily: 'RK Sandook',
    fontUrl: 'https://res.cloudinary.com/fm1bwbrd/raw/upload/v1785863861/AvrileSans-Condensed_n8kslo.ttf',
  },
] as const;

export const searchItems = [
  ...collectionPages.map((collection) => ({
    title: collection.name,
    type: 'Collection',
    href: collection.route,
    keywords: `${collection.name} ${collection.summary}`,
  })),
  { title: 'All Collections', type: 'Collection', href: '/collections', keywords: 'collections archive' },
  { title: 'All Lookbooks', type: 'Lookbook', href: '/rk-lookbooks', keywords: 'lookbook editorial' },
  { title: 'About Rashi Kapoor', type: 'Page', href: '/about', keywords: 'about house story designer' },
] as const;

export const categoryItems: readonly CategoryItem[] = [
  {
    title: 'Aakaar',
    image: 'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785488046/Rashi_Kapoor474_compressed_8000kb_pqcair.jpg',
    href: '/collections/aakaar-insights',
  },
  {
    title: 'Anamika',
    image: 'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785305156/Rashi_Kapoor3092_stukqt.jpg',
    href: '/collections/collections-of-anamika',
  },
  {
    title: 'Hastakala',
    image: 'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785304857/Hasthkalare_hhljut.jpg',
    href: '/collections/collections-of-hasthkala',
  },
  {
    title: 'Inaara',
    image: 'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785305219/RASHI_KAPOOR_-_27-3-240879_xr10ue.jpg',
    href: '/collections/collections-of-inaara',
  },
  {
    title: 'Naqab',
    image: 'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785304902/Naqab_2_re_qdu1xs.jpg',
    href: '/collections/collections-of-naqab',
  },
  {
    title: 'Sandook',
    image: 'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785305276/Rashi_Kapoor_22-03-20220063_nwo7of.jpg',
    href: '/collections/collections-of-sandook',
  },
] as const;

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

export const lookbookCovers = [
  {
    title: 'Aakaar',
    image: 'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785488046/Rashi_Kapoor474_compressed_8000kb_pqcair.jpg',
    href: '/collections/aakaar-insights',
    caption: 'A new chapter in movement and form.',
    span: 'lg:col-span-4',
  },
  {
    title: 'Inaara',
    image: 'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785861901/Inaara_hn30rg.png',
    href: '/rk-lookbooks/inaara',
    caption: 'A luminous, celebratory edit.',
    span: 'lg:col-span-8',
  },
  {
    title: 'Anamika',
    image: 'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785861902/Anamika_ojeh19.png',
    href: '/rk-lookbooks/anamika',
    caption: 'A softer, movement-led chapter.',
    span: 'lg:col-span-5 lg:row-span-2',
  },
  {
    title: 'Hastakala',
    image: 'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785862112/Hastakala_kcb6la.png',
    href: '/rk-lookbooks/hasthkala',
    caption: 'A craft-first visual story.',
    span: 'lg:col-span-3',
  },
  {
    title: 'Espiritu Libre',
    image: 'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785861902/Espi_bbvgfh.png',
    href: '/rk-lookbooks/espiritu-libre',
    caption: 'A free-spirited chapter in motion.',
    span: 'lg:col-span-4',
  },
  {
    title: 'Sandook',
    image: 'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785861901/Sandook_h0rfqg.png',
    href: '/rk-lookbooks/sandook',
    caption: 'A treasured archive of the house.',
    span: 'lg:col-span-4',
  },
] as const;

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
