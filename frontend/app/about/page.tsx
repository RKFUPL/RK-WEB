import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight, Leaf, Scissors, SunMedium } from 'lucide-react';
import { Footer } from '@/components/home/footer';
import { StickyHeader } from '@/components/home/sticky-header';
import { brandStory } from '@/lib/home-content';
import { pageMetadata } from '@/lib/site-metadata';

export const metadata = pageMetadata(
  'About the House',
  'Discover the story, design language, and thoughtful craftsmanship behind Rashi Kapoor.',
  '/about',
);

// Add the approved designer photograph URL here when it is available.
const DESIGNER_IMAGE_URL = '';

const craftImage = 'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785488013/Rashi_Kapoor306_compressed_8000kb_vnw8a0.jpg';
const valuesImage = 'https://res.cloudinary.com/fm1bwbrd/image/upload/v1785487994/Rashi_Kapoor2418_compressed_8000kb_qkke56.jpg';

const values = [
  {
    title: 'Craftsmanship',
    body: 'Attention to fabric, handwork, construction, and the quiet details that give a garment its character.',
    Icon: Scissors,
  },
  {
    title: 'Thoughtful creation',
    body: 'Silhouette, movement, texture, and ease considered together, with purpose rather than excess.',
    Icon: Leaf,
  },
  {
    title: 'Heritage, looking forward',
    body: 'A respect for Indian craft, carried into a contemporary and individual expression.',
    Icon: SunMedium,
  },
] as const;

export default function AboutPage() {
  return (
    <main className="overflow-hidden bg-[#f4ede3] text-[#2a211c]">
      <StickyHeader transparentAtTop transparentTheme="light" />

      <section className="relative isolate min-h-[42rem] overflow-hidden bg-[#241912] text-[#fff9ef] md:min-h-[48rem] lg:min-h-[54rem]">
        <Image src={brandStory.image} alt="Rashi Kapoor contemporary Indian fashion" fill priority sizes="100vw" className="-z-20 object-cover object-[62%_center]" />
        <div className="absolute inset-0 -z-10 bg-[linear-gradient(90deg,rgba(21,13,9,.94)_0%,rgba(21,13,9,.78)_31%,rgba(21,13,9,.25)_67%,rgba(21,13,9,.08)_100%)]" />
        <div className="mx-auto flex min-h-[42rem] max-w-[90rem] items-center px-6 pb-16 pt-28 md:min-h-[48rem] md:px-12 lg:min-h-[54rem] lg:px-16">
          <div className="max-w-xl pt-12">
            <div className="flex items-center gap-5">
              <p className="text-[0.6rem] uppercase tracking-[0.44em] text-[#e6d4bd]">About</p>
              <span className="h-px w-28 bg-white/35" />
            </div>
            <h1 className="mt-8 font-display text-[clamp(4.6rem,8vw,8.4rem)] leading-[0.82] tracking-[-0.055em]">
              A story<br />in every<br /><em className="font-normal">thread.</em>
            </h1>
            <p className="mt-10 max-w-md font-display text-lg leading-8 text-white/86 md:text-xl">
              Rashi Kapoor is a contemporary Indian fashion label rooted in heritage, craftsmanship, and quiet luxury. We create garments for moments that matter—where tradition meets a modern, individual expression.
            </p>
          </div>
        </div>
      </section>

      <section id="the-brand" className="scroll-mt-24 px-6 py-20 md:px-12 md:py-28 lg:px-16 lg:py-32">
        <div className="mx-auto grid max-w-[90rem] gap-12 lg:grid-cols-[1fr_.95fr_.55fr] lg:items-center lg:gap-14">
          <div>
            <div className="flex items-center gap-5">
              <p className="text-[0.6rem] uppercase tracking-[0.42em]">The Brand</p>
              <span className="h-px w-16 bg-[#8c6848]/35" />
            </div>
            <h2 className="mt-7 max-w-lg font-display text-[clamp(3.5rem,5.4vw,6.2rem)] leading-[0.86] tracking-[-0.045em]">Modern heirlooms for today.</h2>
            <div className="mt-8 max-w-xl space-y-6 font-display text-lg leading-7 text-[#5f5047] md:text-xl md:leading-8">
              <p>Rashi Kapoor brings together the richness of Indian craft with a contemporary sensibility. The collections move across occasion wear and bridal dressing, designed for women who value expression, ease, and thoughtful detail.</p>
              <p>Each piece is developed with attention to silhouette, material, handwork, and finish—so that it can be worn in the present and remembered long after.</p>
            </div>
          </div>

          <div className="relative aspect-[4/5] overflow-hidden bg-[#d9c9b8]">
            <Image src={craftImage} alt="Detail of Rashi Kapoor craftsmanship" fill sizes="(max-width: 1024px) 100vw, 38vw" className="object-cover" />
          </div>

          <aside className="relative hidden min-h-[30rem] flex-col items-center justify-center border-l border-[#a88968]/25 px-8 text-center lg:flex">
            <svg aria-hidden="true" viewBox="0 0 180 180" className="w-32 text-[#a77b55]/48" fill="none" stroke="currentColor" strokeWidth="1">
              <path d="M90 164C88 121 91 78 113 25M95 105C75 91 57 80 38 79M103 75C121 66 139 54 148 38M87 130C69 122 57 111 49 96M113 49C102 43 98 31 100 18" />
              <path d="M38 79c7-15 22-18 35-9-7 12-21 18-35 9ZM148 38c-15-4-28 4-31 18 13 3 25-3 31-18ZM49 96c-11 4-18 15-14 26 12-1 20-11 14-26ZM100 18c-11 4-17 15-12 26 11-2 17-12 12-26Z" />
            </svg>
            <p className="mt-9 rotate-[-5deg] font-display text-4xl italic leading-[1.35] text-[#a06f49]">Heritage<br />Craft<br />Contemporary<br />You</p>
            <span className="mt-10 h-px w-24 bg-[#a88968]/55" />
          </aside>
        </div>
      </section>

      <section className="border-y border-[#9d7a58]/20 bg-[#eee4d7]">
        <div className="mx-auto grid max-w-[100rem] lg:grid-cols-[.82fr_1.18fr]">
          <div className="relative min-h-[33rem] overflow-hidden bg-[#2e251f] sm:min-h-[42rem] lg:min-h-[49rem]">
            {DESIGNER_IMAGE_URL ? (
              <img src={DESIGNER_IMAGE_URL} alt="Rashi Kapoor, designer" className="absolute inset-0 h-full w-full object-cover grayscale" />
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-[radial-gradient(circle_at_55%_35%,rgba(190,155,120,.2),transparent_48%),linear-gradient(145deg,#493b31,#211a16)] px-8 text-center">
                <span className="font-display text-8xl text-[#d0ad87]/34">RK</span>
                <span className="mt-7 text-[0.58rem] uppercase tracking-[0.38em] text-white/45">Designer portrait coming soon</span>
              </div>
            )}
          </div>

          <div className="grid md:grid-cols-[1.25fr_.75fr]">
            <div className="flex flex-col justify-center px-7 py-16 md:px-12 lg:px-16 lg:py-20">
              <div className="flex items-center gap-5">
                <p className="text-[0.6rem] uppercase tracking-[0.42em]">The Designer</p>
                <span className="h-px w-20 bg-[#8c6848]/35" />
              </div>
              <h2 className="mt-7 font-display text-[clamp(3.6rem,5.6vw,6.5rem)] leading-[0.86] tracking-[-0.05em]">Rashi Kapoor</h2>
              <div className="mt-8 space-y-6 font-display text-lg leading-7 text-[#5f5047] md:text-xl md:leading-8">
                <p>A designer and storyteller, Rashi Kapoor creates with a deep respect for the textiles, places, and everyday details that shape her way of seeing.</p>
                <p>Her design language lives in contrast: structure and softness, tradition and modernity, presence and restraint. Each collection is a personal exploration of colour, texture, occasion, and the women who bring the clothes to life.</p>
              </div>
              <p className="mt-10 font-display text-4xl italic text-[#8e6142]">Rashi Kapoor</p>
            </div>

            <aside className="relative hidden overflow-hidden border-l border-[#9d7a58]/20 bg-[#e6d6c5] p-7 md:block">
              <div className="absolute left-8 top-10 h-44 w-[62%] rotate-[-2deg] overflow-hidden border-[6px] border-[#f7f0e7] shadow-lg">
                <Image src={valuesImage} alt="Rashi Kapoor inspiration detail" fill sizes="20vw" className="object-cover grayscale" />
              </div>
              <div className="absolute right-5 top-48 h-36 w-[58%] rotate-[3deg] overflow-hidden border-[6px] border-[#f7f0e7] shadow-lg">
                <Image src={craftImage} alt="Embroidered textile detail" fill sizes="20vw" className="object-cover" />
              </div>
              <p className="absolute bottom-16 left-8 right-6 rotate-[-4deg] font-display text-2xl italic leading-8 text-[#805c43]">Inspired by people, places, and beauty found in everyday moments.</p>
            </aside>
          </div>
        </div>
      </section>

      <section className="relative isolate overflow-hidden bg-[#211713] px-6 py-20 text-[#fff9ef] md:px-12 md:py-24 lg:px-16">
        <Image src={valuesImage} alt="" aria-hidden="true" fill sizes="100vw" className="-z-20 object-cover opacity-40" />
        <div className="absolute inset-0 -z-10 bg-[linear-gradient(90deg,rgba(26,17,13,.94),rgba(26,17,13,.72),rgba(26,17,13,.9))]" />
        <div className="mx-auto max-w-[90rem]">
          <div className="flex items-center gap-5">
            <p className="text-[0.6rem] uppercase tracking-[0.42em] text-[#e3ccb1]">Our people and process</p>
            <span className="h-px w-28 bg-white/30" />
          </div>
          <div className="mt-14 grid gap-10 md:grid-cols-3 md:gap-8 lg:gap-16">
            {values.map(({ title, body, Icon }) => (
              <article key={title} className="border-t border-white/20 pt-7">
                <Icon size={30} strokeWidth={1.15} className="text-[#d3b28d]" />
                <h3 className="mt-8 text-[0.65rem] uppercase tracking-[0.35em] text-[#f3e2ce]">{title}</h3>
                <p className="mt-4 max-w-sm font-display text-lg leading-7 text-white/75 md:text-xl md:leading-8">{body}</p>
              </article>
            ))}
          </div>
          <div className="mt-16 flex justify-end">
            <Link href="/collections" className="inline-flex items-center gap-4 border-b border-[#d3b28d] pb-3 text-[0.62rem] uppercase tracking-[0.3em] text-[#f3e2ce] transition hover:text-white">
              Explore the collections <ArrowRight size={16} strokeWidth={1.3} />
            </Link>
          </div>
        </div>
      </section>

      <Footer />
    </main>
  );
}
