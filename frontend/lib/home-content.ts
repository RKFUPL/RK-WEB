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
  image: 'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785303898/Rashi_Kapoor1358_v3er22.jpg',
  cta: 'Browse the Collection',
};

export const featuredCollectionFrames = [
  'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785303898/Rashi_Kapoor474_cqm17y.jpg',
  'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785303898/Rashi_Kapoor1358_v3er22.jpg',
  'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785303898/Rashi_Kapoor2418_nebluo.jpg',
  'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785303897/Rashi_Kapoor306_dnwh99.jpg',
  'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785303897/Rashi_Kapoor187_nx9fpm.jpg',
] as const;

export const collectionPages: readonly CollectionPage[] = [
  {
    name: 'Aakaar',
    route: '/collections/aakaar-insights',
    status: 'Coming Soon',
    summary: 'The debut collection, defined by sculpted drapes and quiet couture detailing.',
    image: 'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785304593/Rashi_Kapoor1351_xzrpyx.jpg',
  },
  {
    name: 'Anamika',
    route: '/collections/collections-of-anamika',
    status: 'Collection',
    summary: 'A refined story shaped by movement, texture, and modern occasion dressing.',
    image: 'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785305156/Rashi_Kapoor3092_stukqt.jpg',
  },
  {
    name: 'Hasthkala',
    route: '/collections/collections-of-hasthkala',
    status: 'Collection',
    summary: 'Craft-led silhouettes with a more artisanal, hand-finished mood.',
    image: 'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785304857/Hasthkalare_hhljut.jpg',
  },
  {
    name: 'Inaara',
    route: '/collections/collections-of-inaara',
    status: 'Collection',
    summary: 'A luminous edit with fluid lines and softer, celebratory energy.',
    image: 'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785305219/RASHI_KAPOOR_-_27-3-240879_xr10ue.jpg',
  },
  {
    name: 'Naqab',
    route: '/collections/collections-of-naqab',
    status: 'Collection',
    summary: 'A more dramatic chapter built around veiled layers and evening presence.',
    image: 'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785304902/Naqab_2_re_qdu1xs.jpg',
  },
  {
    name: 'Sandook',
    route: '/collections/collections-of-sandook',
    status: 'Collection',
    summary: 'A heritage-leaning story with a more treasured, heirloom-like mood.',
    image: 'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785305276/Rashi_Kapoor_22-03-20220063_nwo7of.jpg',
  },
] as const;

export const categoryItems: readonly CategoryItem[] = [
  {
    title: 'Aakaar',
    image: 'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785304593/Rashi_Kapoor1351_xzrpyx.jpg',
    href: '/collections/aakaar-insights',
  },
  {
    title: 'Anamika',
    image: 'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785305156/Rashi_Kapoor3092_stukqt.jpg',
    href: '/collections/collections-of-anamika',
  },
  {
    title: 'Hasthkala',
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
    image: 'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785303898/Rashi_Kapoor474_cqm17y.jpg',
    span: 'lg:col-span-5 lg:row-span-2',
  },
  {
    title: 'Look 02',
    caption: 'Editorial layering with couture lines',
    image: 'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785303898/Rashi_Kapoor1358_v3er22.jpg',
    span: 'lg:col-span-3',
  },
  {
    title: 'Look 03',
    caption: 'Occasionwear with sculpted volume',
    image: 'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785303898/Rashi_Kapoor2418_nebluo.jpg',
    span: 'lg:col-span-4',
  },
  {
    title: 'Look 04',
    caption: 'Bridal motion, quiet opulence',
    image: 'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785303897/Rashi_Kapoor306_dnwh99.jpg',
    span: 'lg:col-span-4',
  },
  {
    title: 'Look 05',
    caption: 'Resort ease in a luxury frame',
    image: 'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785303897/Rashi_Kapoor187_nx9fpm.jpg',
    span: 'lg:col-span-8',
  },
] as const;

export const brandStory = {
  title: 'The House of Rashi Kapoor',
  description:
    'Luxury womenswear rooted in craftsmanship, modern Indian occasion dressing, and a cinematic visual language designed to feel timeless.',
  image: 'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785303898/Rashi_Kapoor1358_v3er22.jpg',
  cta: 'Read More',
};

export const testimonials = [
  {
    quote:
      'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Integer vitae justo eget magna.',
    name: 'Ananya S.',
    role: 'Client',
  },
  {
    quote:
      'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt.',
    name: 'Meher K.',
    role: 'Client',
  },
  {
    quote:
      'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Ut enim ad minim veniam quis.',
    name: 'Ritika P.',
    role: 'Client',
  },
  {
    quote:
      'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis aute irure dolor in.',
    name: 'Naina V.',
    role: 'Client',
  },
  {
    quote:
      'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Excepteur sint occaecat cupidatat.',
    name: 'Sana M.',
    role: 'Client',
  },
  {
    quote:
      'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nunc dignissim, massa at.',
    name: 'Diya R.',
    role: 'Client',
  },
] as const;

export const instagramItems = [
  'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785303898/Rashi_Kapoor474_cqm17y.jpg',
  'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785303898/Rashi_Kapoor1358_v3er22.jpg',
  'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785303898/Rashi_Kapoor2418_nebluo.jpg',
  'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785303897/Rashi_Kapoor306_dnwh99.jpg',
  'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785303897/Rashi_Kapoor187_nx9fpm.jpg',
  'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785303898/Rashi_Kapoor474_cqm17y.jpg',
] as const;
