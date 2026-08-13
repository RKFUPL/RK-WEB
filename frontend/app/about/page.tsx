import { EditorialPage } from '@/components/site/editorial-page';
import { brandStory } from '@/lib/home-content';
import { pageMetadata } from '@/lib/site-metadata';

export const metadata = pageMetadata('Rashi Kapoor — About the House', 'Discover the design language and point of view behind Rashi Kapoor.', '/about');

export default function AboutPage() {
  return <EditorialPage eyebrow="The house of Rashi Kapoor" title="Designed with intention." intro="Rashi Kapoor is a fashion house shaped by Indian craft, contemporary expression, and the emotional life of clothing. Each chapter begins with silhouette, texture, and the feeling a garment leaves behind." sections={[
    { eyebrow: '01', title: 'A modern Indian identity.', body: 'The work moves between a respect for tradition and a clear contemporary point of view. Fabric, drape, proportion, and movement are considered together so that every look feels composed, expressive, and alive.', image: brandStory.image, imageAlt: 'Rashi Kapoor fashion editorial' },
    { eyebrow: '02', title: 'Detail is the language.', body: 'Embroidery, surface work, finishing, and construction are not afterthoughts. They give a garment its rhythm and invite a closer look — the quiet details that make a piece feel personal.', image: 'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785488013/Rashi_Kapoor306_compressed_8000kb_vnw8a0.jpg', imageAlt: 'Rashi Kapoor couture detail', imageFirst: true },
    { eyebrow: '03', title: 'Clothing with feeling.', body: 'The house designs for the moment before an occasion, the movement through a room, and the memory that remains after it. Luxury is held in the balance between presence and ease.', image: 'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785487994/Rashi_Kapoor2418_compressed_8000kb_qkke56.jpg', imageAlt: 'Rashi Kapoor occasion dressing' },
  ]} closing="The house is an ongoing conversation between craft, silhouette, and the women who wear it." />;
}
