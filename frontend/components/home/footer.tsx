'use client';

import Link from 'next/link';
import { brandLogoUrl, storeInteriorVideoUrl } from '@/lib/home-content';

const footerColumns = [
  {
    title: 'Navigation',
    links: ['Collections', 'Lookbook', 'About', 'Contact'],
  },
  {
    title: 'Customer Care',
    links: ['Shipping', 'Returns', 'Sizing', 'Appointments', 'Support'],
  },
  {
    title: 'Company',
    links: ['Story', 'Craftsmanship', 'Careers', 'Sustainability'],
  },
  {
    title: 'Policies',
    links: ['Privacy', 'Terms', 'Cookies', 'Security'],
  },
] as const;

export function Footer() {
  return (
    <footer id="footer" className="border-t border-white/10 bg-ink text-ivory">
      {/* Video Section - Store Locator */}
      <div className="relative w-full bg-ink">
        <video
          autoPlay
          loop
          muted
          playsInline
          className="w-full object-cover"
          style={{ maxHeight: '400px' }}
        >
          <source src={storeInteriorVideoUrl} type="video/mp4" />
        </video>
        <div className="absolute inset-0 flex items-center justify-between px-6 lg:px-10 bg-white/30">
          <div className="text-center">
            <h3 className="font-display text-3xl tracking-[0.25em] text-black md:text-5xl font-bold drop-shadow-lg">STORE LOCATOR</h3>
            <p className="mt-4 text-sm uppercase tracking-[0.38em] text-black font-bold drop-shadow-lg">Visit Our Stores</p>
          </div>
          <div className="hidden md:block text-right">
            <div className="flex items-center gap-8">
              <div className="text-left">
                <h4 className="font-display text-base tracking-[0.2em] text-black font-bold drop-shadow-lg">ADDRESS 1</h4>
                <p className="mt-3 text-base text-black font-bold drop-shadow-lg">15, Satyen Dutta Road, </p>
                <p className="text-base text-black font-bold drop-shadow-lg">Lake Market, Kalighat</p>
                <p className="text-base text-black font-bold drop-shadow-lg">Kolkata, West Bengal</p>
                <p className="text-base text-black font-bold drop-shadow-lg">700029</p>
              </div>
              <div className="h-16 w-px bg-black"></div>
              <div className="text-left">
                <h4 className="font-display text-base tracking-[0.2em] text-black font-bold drop-shadow-lg">ADDRESS 2</h4>
                <p className="mt-3 text-base text-black font-bold drop-shadow-lg">38/B Wing, 2nd Floor, </p>
                <p className="text-base text-black font-bold drop-shadow-lg">Pravasi Industrial Estate,</p>
                <p className="text-base text-black font-bold drop-shadow-lg">Goregaon East, Mumbai</p>
                <p className="text-base text-black font-bold drop-shadow-lg">400063</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Contact Section */}
      <div className="mx-auto max-w-7xl px-6 py-12 lg:px-10">
        <div className="grid gap-8 border-b border-white/10 pb-12 md:grid-cols-2">
          <div>
            <h4 className="font-display text-xl tracking-[0.2em] text-gold">Contact Us</h4>
          </div>
          <div className="md:hidden">
            <h4 className="font-display text-xl tracking-[0.2em] text-gold">Visit Us</h4>
            <div className="mt-4 space-y-3 text-sm text-ivory/80">
              <p>Flagship Store</p>
              <p>Kolkata, India</p>
              <p className="mt-4">Second Location</p>
              <p>Mumbai, India</p>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-6 py-16 lg:px-10">
        <div className="grid gap-10 lg:grid-cols-[1.2fr_1fr]">
          <div className="space-y-4">
            <div className="inline-flex items-center justify-center bg-ivory/30 px-4 py-3">
              <img
                src={brandLogoUrl}
                alt="RK Logo"
                width="120"
                height="60"
                className="h-16 w-auto"
                style={{ width: 'auto', height: '4rem' }}
              />
            </div>
            <p className="max-w-md text-sm leading-7 text-ivory/70">
              Rashi Kapoor luxury womenswear. An editorial platform built to evolve with the house,
              its collections, and future CMS-driven storytelling.
            </p>
          </div>
          <div className="grid gap-8 sm:grid-cols-2 xl:grid-cols-4">
            {footerColumns.map((column) => (
              <div key={column.title}>
                <p className="text-xs uppercase tracking-[0.38em] text-ivory/45">{column.title}</p>
                <ul className="mt-4 space-y-3 text-sm text-ivory/72">
                  {column.links.map((link) => (
                    <li key={link}>
                      {column.title === 'Navigation' ? (
                        <Link
                          href={
                            link === 'Collections'
                              ? '/collections'
                              : link === 'Lookbook'
                                ? '/rk-lookbooks'
                                : link === 'About'
                                  ? '/#about'
                                  : '#footer'
                          }
                          className="transition hover:text-gold"
                        >
                          {link}
                        </Link>
                      ) : (
                        <a
                          href={`#${link.toLowerCase().replace(/\s+/g, '-')}`}
                          className="transition hover:text-gold"
                        >
                          {link}
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
        <div className="mt-12 flex flex-col gap-3 border-t border-white/10 pt-6 text-xs uppercase tracking-[0.3em] text-ivory/45 sm:flex-row sm:items-center sm:justify-between">
          <p>Copyright 2026 Rashi Kapoor</p>
          <p>Instagram, Pinterest, YouTube</p>
        </div>
      </div>
    </footer>
  );
}
