'use client';

import Link from 'next/link';
import { Heart } from 'lucide-react';
import { useEffect, useState } from 'react';

export default function WishlistPage() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    setSignedIn(Boolean(window.localStorage.getItem('rk_access_token')));
  }, []);

  if (signedIn === null) return null;

  return (
    <main className="min-h-screen bg-ivory px-6 py-24 text-charcoal lg:px-12">
      <div className="mx-auto max-w-3xl text-center">
        <Heart className="mx-auto h-8 w-8 text-gold" strokeWidth={1.25} />
        <p className="mt-8 text-xs uppercase tracking-[0.35em] text-charcoal/50">Your wishlist</p>
        <h1 className="mt-4 font-display text-5xl">{signedIn ? 'Nothing saved yet.' : 'Sign in to view your wishlist.'}</h1>
        <p className="mx-auto mt-5 max-w-md text-sm leading-7 text-charcoal/60">
          {signedIn ? 'Pieces you save will appear here for an easy return whenever you are ready.' : 'Your saved pieces are connected to your RK account.'}
        </p>
        {!signedIn ? <Link href="/account" className="mt-10 inline-flex rounded-full bg-ink px-7 py-4 text-xs uppercase tracking-[0.28em] text-ivory transition hover:bg-gold">Sign in</Link> : null}
        <Link
          href="/collections"
          className={`${signedIn ? 'mt-10' : 'mt-4'} inline-flex border border-charcoal px-7 py-4 text-xs uppercase tracking-[0.28em] transition hover:border-gold hover:text-gold`}
        >
          Explore Collections
        </Link>
      </div>
    </main>
  );
}
