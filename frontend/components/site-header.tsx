'use client';

import { brandLogoUrl } from '@/lib/home-content';

export function SiteHeader() {
  return (
    <header className="border-b border-black/5 bg-ivory">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5 lg:px-10">
        <div>
          <img
            src={brandLogoUrl}
            alt="RK Logo"
            width="80"
            height="40"
            className="h-10 w-auto"
            style={{ width: 'auto', height: '2.5rem' }}
          />
        </div>
        <nav className="hidden gap-8 text-xs uppercase tracking-[0.28em] text-charcoal/70 md:flex">
          <a href="/">Home</a>
          <a href="/collections">Collections</a>
          <a href="/rk-lookbooks">Lookbook</a>
          <a href="/#about">About</a>
          <a href="/#footer">Contact</a>
        </nav>
      </div>
    </header>
  );
}
