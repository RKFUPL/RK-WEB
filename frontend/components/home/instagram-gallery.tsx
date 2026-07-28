import Image from 'next/image';
import { instagramItems } from '@/lib/home-content';
import { SectionShell } from './section-shell';

export function InstagramGallery() {
  return (
    <SectionShell id="contact" className="bg-ivory">
      <div className="max-w-2xl space-y-4">
        <p className="text-xs uppercase tracking-[0.38em] text-charcoal/50">Instagram Gallery</p>
        <h2 className="font-display text-4xl leading-none text-charcoal md:text-6xl">
          A visual diary of the house.
        </h2>
      </div>
      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {instagramItems.map((image, index) => (
          <article key={image} className="group relative aspect-[4/5] overflow-hidden bg-white">
            <Image
              src={image}
              alt={`Instagram placeholder ${index + 1}`}
              fill
              sizes="(max-width: 1024px) 50vw, 33vw"
              className="object-cover object-center transition duration-700 group-hover:scale-[1.05]"
            />
          </article>
        ))}
      </div>
    </SectionShell>
  );
}
