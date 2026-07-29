type CategoryItem = {
  title: string;
  image?: string;
  href?: string;
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

export const categoryItems: readonly CategoryItem[] = [
  {
    title: 'Aakaar',
    image: 'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785304593/Rashi_Kapoor1351_xzrpyx.jpg',
    href: '/collections/aakaar-insights',
  },
  {
    title: 'Anamika',
    image: 'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785305156/Rashi_Kapoor3092_stukqt.jpg',
  },
  {
    title: 'Hasthkala',
    image: 'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785304857/Hasthkalare_hhljut.jpg',
  },
  {
    title: 'Inaara',
    image: 'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785305219/RASHI_KAPOOR_-_27-3-240879_xr10ue.jpg',
  },
  {
    title: 'Naqab',
    image: 'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785304902/Naqab_2_re_qdu1xs.jpg',
  },
  {
    title: 'Sandook',
    image: 'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785305276/Rashi_Kapoor_22-03-20220063_nwo7of.jpg',
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
      'The craftsmanship was even more beautiful in person, and the entire experience felt thoughtful from start to finish.',
    name: 'Ananya S.',
    role: 'Client',
  },
  {
    quote:
      'Every detail felt refined and effortless. The silhouette, finish, and fit all came together beautifully.',
    name: 'Meher K.',
    role: 'Client',
  },
  {
    quote:
      'The outfit arrived impeccably packaged and felt truly special the moment we opened it.',
    name: 'Ritika P.',
    role: 'Client',
  },
  {
    quote:
      'Aakar has such a distinct visual language. It feels elegant, modern, and deeply considered.',
    name: 'Naina V.',
    role: 'Client',
  },
  {
    quote:
      'The drape and detailing made the piece stand out in the most graceful way.',
    name: 'Sana M.',
    role: 'Client',
  },
  {
    quote:
      'What I loved most was how luxurious it felt without ever being overdone.',
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
