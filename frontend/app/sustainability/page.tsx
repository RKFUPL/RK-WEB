import { EditorialPage } from '@/components/site/editorial-page';
import { pageMetadata } from '@/lib/site-metadata';

export const metadata = pageMetadata('Rashi Kapoor — Sustainability', 'An evolving approach to considered fashion, craft, longevity, and transparency.', '/sustainability');

export default function SustainabilityPage() {
  return <EditorialPage eyebrow="An evolving practice" title="Considered by design." intro="For a fashion house, responsibility is a process: asking better questions about materials, making, longevity, packaging, and the people behind every detail. This page is a framework for the practices RK is continuing to define and document." sections={[
    { eyebrow: '01', title: 'Craft & longevity.', body: 'A considered wardrobe begins with pieces made to be lived in beyond a single season. Careful construction, enduring silhouettes, and respect for finish give clothing the opportunity to remain meaningful over time.', image: 'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785488013/Rashi_Kapoor306_compressed_8000kb_vnw8a0.jpg', imageAlt: 'Detailed couture craftsmanship' },
    { eyebrow: '02', title: 'Materials, documented.', body: 'Material choices are part of the story and should be recorded with clarity. The house is building a more complete account of fibres, trims, dyeing, sourcing, and care so that future decisions can be understood and improved.', image: 'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785487994/Rashi_Kapoor2418_compressed_8000kb_qkke56.jpg', imageAlt: 'Textile detail', imageFirst: true },
    { eyebrow: '03', title: 'People & practice.', body: 'Indian craftsmanship, hand techniques, embroidery, and skilled making carry knowledge that deserves attention and continuity. Thoughtful production starts with valuing that work and making the process more visible.', image: 'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785930123/d8de58e0-7866-4bbd-8867-492437e4a0a2_wlonjn.png', imageAlt: 'Atmospheric Rashi Kapoor studio scene' },
    { eyebrow: '04', title: 'A commitment in progress.', body: 'Sustainability is not a finished statement. It is an evolving commitment to transparency, fewer assumptions, and better information — including clear areas where the house still needs to confirm and publish its practices.', imageFirst: true },
  ]} closing="Better questions make better clothes." />;
}
