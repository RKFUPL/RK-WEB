'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Facebook, Instagram, Linkedin, Youtube } from 'lucide-react';
import { brandLogoUrl, storeInteriorVideoUrl } from '@/lib/home-content';

const footerColumns = [
  {
    title: 'Navigation',
    links: ['Collections', 'Lookbook', 'About', 'Contact'],
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

// Update social destinations here when the final brand profiles are ready.
const socialLinks = {
  instagram: 'https://www.instagram.com/rashikapoorofficial/',
  pinterest: 'https://www.pinterest.com/',
  youtube: 'https://www.youtube.com/',
  facebook: 'https://www.facebook.com/',
  linkedin: 'https://www.linkedin.com/company/rashi-kapoor-fashion-unicus-private-limited/',
  x: 'https://x.com/',
} as const;

const storeLocations = [
  {
    name: 'Kolkata Flagship Store',
    address: '15B, Satyen Dutta Road, Lake Market, Kalighat, Kolkata, West Bengal 700029',
    mapUrl:
      'https://www.google.com/maps?sca_esv=3e69f37c1e17d2ac&sxsrf=APpeQnu9WTWUVJsAj5T1iWzzLXVdylnNyw:1785495763205&gs_lp=Egxnd3Mtd2l6LXNlcnAiIHJhc2hpIGthcG9vciB0aGUgZmxhZ3NoaXAgc3RvcmUgKgIIAjIGEAAYFhgeMgYQABgWGB4yBhAAGBYYHjIGEAAYFhgeMgYQABgWGB4yBRAAGO8FMggQABiABBiiBEiSDVBhWGFwAXgAkAEAmAGhAaABlQKqAQMwLjK4AQHIAQD4AQGYAgKgAqgBwgIHEAAYHhiwA8ICCBAAGO8FGLADwgILEAAYgAQYogQYsAOYAwCIBgGQBgeSBwMxLjGgB_MIsgcDMC4xuAekAcIHAzAuMsgHBIAIAQ&um=1&ie=UTF-8&fb=1&gl=in&sa=X&geocode=KZuMH11IcQI6MbNC1PfP7FBd&daddr=15B,+Satyen+Dutta+Road,+Lake+Market,+Kalighat,+Kolkata,+West+Bengal+700029',
  },
  {
    name: 'Mumbai Factory and Showroom',
    address: '373/2988, Road No. 2, near Ganesh Maidan, off Mahatma Gandhi Road, Motilal Nagar II, Goregaon West, Mumbai, Maharashtra 400104',
    mapUrl:
      'https://www.google.com/maps?um=1&ie=UTF-8&fb=1&gl=in&sa=X&geocode=KQ1AnVopt-c7McghiwiTGSNr&daddr=373/2988,+Road+No.+2,+near+Ganesh+Maidan,+off+Mahatma+Gandhi+Road,+Motilal+Nagar+II,+Goregaon+West,+Mumbai,+Maharashtra+400104',
  },
] as const;

export function Footer() {
  const pathname = usePathname();
  const router = useRouter();

  const scrollToAbout = () => {
    const about = document.getElementById('about');
    if (about) {
      about.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }

    if (pathname !== '/') {
      router.push('/');
      window.setTimeout(() => {
        document.getElementById('about')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    }
  };

  const scrollToFooter = () => {
    const footer = document.getElementById('footer');
    if (footer) {
      footer.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }

    if (pathname !== '/') {
      router.push('/');
      window.setTimeout(() => {
        document.getElementById('footer')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    }
  };

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
        </div>
      </div>

      <div className="grid gap-px bg-white/10 md:grid-cols-2">
        {storeLocations.map((location) => (
          <div key={location.name} className="bg-ink">
            <iframe
              title={`${location.name} map`}
              src={`https://www.google.com/maps?q=${encodeURIComponent(location.address)}&output=embed`}
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              className="h-64 w-full border-0 grayscale md:h-80"
            />
            <div className="flex items-center justify-between gap-4 px-6 py-5 lg:px-10">
              <div>
                <h4 className="text-sm uppercase tracking-[0.25em] text-ivory">{location.name}</h4>
                <p className="mt-2 max-w-md text-sm leading-6 text-ivory/60">{location.address}</p>
              </div>
              <a
                href={location.mapUrl}
                target="_blank"
                rel="noreferrer"
                className="shrink-0 text-xs uppercase tracking-[0.2em] text-gold transition hover:text-ivory"
              >
                Directions
              </a>
            </div>
          </div>
        ))}
      </div>

      {/* Contact Section */}
      <div className="mx-auto max-w-7xl px-6 py-12 lg:px-10">
        <div className="grid gap-8 border-b border-white/10 pb-12 md:grid-cols-2">
          <div>
            <a
              href="mailto:contact@rashikapoorofficial.com"
              className="font-display text-xl tracking-[0.2em] text-gold transition hover:text-ivory"
            >
              Contact Us
            </a>
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
            <div className="inline-flex items-center justify-center px-4 py-3">
              <img
                src={brandLogoUrl}
                alt="RK Logo"
                width="120"
                height="60"
                className="rk-logo h-16 w-auto"
                style={{ width: 'auto', height: '4rem', filter: 'brightness(0) invert(1)' }}
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
                        link === 'Contact' ? (
                          <button type="button" onClick={scrollToFooter} className="transition hover:text-gold">
                            {link}
                          </button>
                        ) : link === 'About' ? (
                          <button type="button" onClick={scrollToAbout} className="transition hover:text-gold">
                            {link}
                          </button>
                        ) : (
                          <Link
                            href={
                              link === 'Collections'
                                ? '/collections'
                                : link === 'Lookbook'
                                  ? '/rk-lookbooks'
                                  : '/about-rk'
                            }
                            className="transition hover:text-gold"
                          >
                            {link}
                          </Link>
                        )
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
        <div className="mt-12 border-t border-white/10 pt-8">
          <div className="flex flex-wrap items-center justify-center gap-5">
            <a href={socialLinks.instagram} target="_blank" rel="noreferrer" aria-label="Instagram" className="text-ivory/60 transition hover:text-gold">
              <Instagram size={19} strokeWidth={1.5} />
            </a>
            <a href={socialLinks.pinterest} target="_blank" rel="noreferrer" aria-label="Pinterest" className="flex h-5 w-5 items-center justify-center rounded-full border border-current text-[0.7rem] font-semibold text-ivory/60 transition hover:text-gold">
              P
            </a>
            <a href={socialLinks.youtube} target="_blank" rel="noreferrer" aria-label="YouTube" className="text-ivory/60 transition hover:text-gold">
              <Youtube size={21} strokeWidth={1.5} />
            </a>
            <a href={socialLinks.facebook} target="_blank" rel="noreferrer" aria-label="Facebook" className="text-ivory/60 transition hover:text-gold">
              <Facebook size={19} strokeWidth={1.5} />
            </a>
            <a href={socialLinks.linkedin} target="_blank" rel="noreferrer" aria-label="LinkedIn" className="text-ivory/60 transition hover:text-gold">
              <Linkedin size={19} strokeWidth={1.5} />
            </a>
            <a href={socialLinks.x} target="_blank" rel="noreferrer" aria-label="X" className="text-lg text-ivory/60 transition hover:text-gold">
              X
            </a>
          </div>
        </div>
      </div>

      <div className="flex flex-col items-center justify-center gap-4 bg-ivory px-6 py-10 text-center text-charcoal">
        <p className="text-sm tracking-[0.04em]">Copyright 2026 Rashi Kapoor Fashion Unicus Pvt. Ltd.</p>
        <img src={brandLogoUrl} alt="RK Logo" width="72" height="52" className="rk-logo h-14 w-auto" />
      </div>
    </footer>
  );
}
