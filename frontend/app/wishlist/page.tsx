import Link from 'next/link';
import { Heart } from 'lucide-react';

export default function WishlistPage() {
  return (
    <main className="min-h-screen bg-ivory px-6 py-24 text-charcoal lg:px-12">
      <div className="mx-auto max-w-3xl text-center">
        <Heart className="mx-auto h-8 w-8 text-gold" strokeWidth={1.25} />
        <p className="mt-8 text-xs uppercase tracking-[0.35em] text-charcoal/50">Your wishlist</p>
        <h1 className="mt-4 font-display text-5xl">Nothing saved yet.</h1>
        <p className="mx-auto mt-5 max-w-md text-sm leading-7 text-charcoal/60">
          Pieces you save will appear here for an easy return whenever you are ready.
        </p>
        <Link
          href="/collections"
          className="mt-10 inline-flex border border-charcoal px-7 py-4 text-xs uppercase tracking-[0.28em] transition hover:border-gold hover:text-gold"
        >
          Explore Collections
        </Link>
      </div>
    </main>
  );
}
