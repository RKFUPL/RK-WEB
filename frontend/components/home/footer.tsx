'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Instagram, Linkedin } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { brandLogoUrl, featuredLooks, storeInteriorVideoUrl } from '@/lib/home-content';
import { CAREERS_URL } from '@/lib/external-links';
import { legalIdentity } from '@/lib/legal-identity';
import { storefrontSocialLinks } from '@/lib/storefront-social';

const footerColumns = [
  {
    title: 'Explore',
    links: [
      { label: 'Shop', href: '/shop' },
      { label: 'Collections', href: '/collections' },
      { label: 'Lookbook', href: '/rk-lookbooks' },
      { label: 'Runway', href: '/runway' },
      { label: 'About', href: '/about' },
    ],
  },
  {
    title: 'Client Services',
    links: [
      { label: 'Contact', href: `mailto:${legalIdentity.customerCareEmail}` },
      { label: 'Made-to-Measure', href: `mailto:${legalIdentity.customerCareEmail}?subject=Made-to-Measure%20Enquiry` },
    ],
  },
  {
    title: 'The House',
    links: [
      { label: 'Careers', href: CAREERS_URL, external: true },
      { label: 'Sustainability', href: '/sustainability' },
    ],
  },
] as const;

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
  const [mediaFailed, setMediaFailed] = useState(false);
  const [videoVisible, setVideoVisible] = useState(false);
  const videoSectionRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const section = videoSectionRef.current;
    if (!section || typeof IntersectionObserver === 'undefined') {
      setVideoVisible(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      setVideoVisible(true);
      observer.disconnect();
    }, { rootMargin: '600px 0px' });
    observer.observe(section);
    return () => observer.disconnect();
  }, []);

  return (
    <footer id="footer" className="luxury-footer border-t border-gold/20 bg-ink text-ivory">
      {/* Video Section - Store Locator */}
      <div ref={videoSectionRef} className="relative w-full overflow-hidden bg-ink">
        {mediaFailed || !videoVisible ? (
          <img src={featuredLooks[0].image} alt="Rashi Kapoor couture interior" className="h-[min(52vw,420px)] w-full object-cover object-center" />
        ) : (
          <video
            autoPlay
            loop
            muted
            playsInline
            preload="metadata"
            onError={() => setMediaFailed(true)}
            className="h-[min(52vw,420px)] w-full object-cover object-center"
            poster={featuredLooks[0].image}
          >
            <source src={storeInteriorVideoUrl} type="video/mp4" />
          </video>
        )}
        <div className="absolute inset-0 flex items-end justify-between bg-gradient-to-t from-[#0c0908]/88 via-[#0c0908]/15 to-transparent px-6 pb-8 lg:px-12 lg:pb-10">
          <div>
            <p className="mb-3 text-[0.6rem] uppercase tracking-[0.36em] text-gold">The house in person</p>
            <h3 className="font-display text-4xl leading-none tracking-[-0.03em] text-ivory md:text-6xl">Visit the house.</h3>
            <p className="mt-4 text-[0.62rem] uppercase tracking-[0.34em] text-ivory/65">Kolkata · Mumbai</p>
          </div>
          <span className="hidden border-l border-gold/70 pl-4 text-[0.58rem] uppercase leading-[1.8] tracking-[0.26em] text-ivory/60 md:block">Store locator<br />Private appointments<br />by invitation</span>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-6 py-14 lg:px-10 lg:py-18">
        <div className="mb-9 flex flex-wrap items-end justify-between gap-6 border-b border-white/10 pb-6">
          <div><p className="text-[0.62rem] uppercase tracking-[0.36em] text-gold">Locations</p><h2 className="mt-3 font-display text-3xl leading-none text-ivory md:text-5xl">Kolkata &amp; Mumbai.</h2></div>
          <p className="max-w-sm text-sm leading-7 text-ivory/55">Private appointments, considered fittings and a closer look at the craft behind every collection.</p>
        </div>
      <div className="grid gap-6 md:grid-cols-2">
        {storeLocations.map((location) => (
          <div key={location.name} className="overflow-hidden border border-white/10 bg-[#15100d]">
            <iframe
              title={`${location.name} map`}
              src={`https://www.google.com/maps?q=${encodeURIComponent(location.address)}&output=embed`}
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              className="h-52 w-full border-0 grayscale md:h-64"
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
      </div>

      <div className="mx-auto max-w-7xl px-6 py-16 sm:py-20 lg:px-10 lg:py-24">
        <div className="grid gap-14 border-b border-white/10 pb-12 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1.35fr)] lg:gap-16 lg:pb-14">
          <div>
            <div className="inline-flex items-center justify-center">
              <img
                src={brandLogoUrl}
                alt="Rashi Kapoor"
                width="92"
                height="48"
                className="footer-brand-mark h-11 w-auto"
              />
            </div>
            <p className="mt-7 max-w-xl font-display text-[1.55rem] leading-[1.2] text-ivory sm:text-[1.75rem] md:text-[1.9rem] xl:text-[2.15rem]">
              <span className="block sm:whitespace-nowrap">Fashion is not just what you wear,</span><em className="mt-2 inline-block text-gold">it&apos;s a legacy you carry.</em>
            </p>
            <p className="mt-6 max-w-md text-sm leading-7 text-ivory/55">Indian craftsmanship, considered design and a modern couture perspective.</p>
          </div>
          <nav aria-label="Footer navigation" className="grid grid-cols-1 gap-x-10 gap-y-10 sm:grid-cols-3 lg:gap-x-14">
            {footerColumns.map((column) => (
              <div key={column.title}>
                <p className="text-[0.6rem] uppercase tracking-[0.26em] text-gold">{column.title}</p>
                <ul className="mt-5 space-y-3 text-sm leading-6 text-ivory/72">
                  {column.links.map((link) => (
                    <li key={link.label}>
                      {link.href.startsWith('mailto:') || ('external' in link && link.external) ? (
                        <a href={link.href} className="rounded-sm transition hover:text-ivory focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-4 focus-visible:outline-gold">{link.label}</a>
                      ) : (
                        <Link
                          href={link.href}
                          aria-current={pathname === link.href ? 'page' : undefined}
                          className={`rounded-sm transition hover:text-ivory focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-4 focus-visible:outline-gold ${pathname === link.href ? 'text-gold' : ''}`}
                        >{link.label}</Link>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>
        <div className="flex flex-col gap-8 border-b border-white/10 py-8 sm:flex-row sm:items-end sm:justify-between lg:py-9">
          <div>
            <p className="text-[0.6rem] uppercase tracking-[0.26em] text-ivory/45">Contact the House</p>
            <div className="mt-4 flex flex-col gap-2 text-sm text-ivory/72 sm:flex-row sm:gap-7">
              <a href={`mailto:${legalIdentity.customerCareEmail}`} className="rounded-sm transition hover:text-gold focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-4 focus-visible:outline-gold">{legalIdentity.customerCareEmail}</a>
              <a href={`tel:${legalIdentity.customerCarePhone.replace(/[\s()-]/g, '')}`} className="rounded-sm transition hover:text-gold focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-4 focus-visible:outline-gold">{legalIdentity.customerCarePhone}</a>
            </div>
          </div>
          <div className="flex items-center gap-5">
            <a href={storefrontSocialLinks.instagram} target="_blank" rel="noreferrer" aria-label="Rashi Kapoor on Instagram" className="rounded-sm text-ivory/65 transition hover:text-gold focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-4 focus-visible:outline-gold">
              <Instagram size={20} strokeWidth={1.45} aria-hidden="true" />
            </a>
            <a href={storefrontSocialLinks.linkedin} target="_blank" rel="noreferrer" aria-label="Rashi Kapoor on LinkedIn" className="rounded-sm text-ivory/65 transition hover:text-gold focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-4 focus-visible:outline-gold">
              <Linkedin size={20} strokeWidth={1.45} aria-hidden="true" />
            </a>
          </div>
        </div>
        <div className="flex flex-col gap-4 pt-7 text-xs text-ivory/40 sm:flex-row sm:items-center sm:justify-between">
          <p>© 2026 {legalIdentity.companyName}</p>
          <div className="flex flex-wrap items-center gap-y-2">
            <Link href="/shipping-returns" className="font-semibold text-gold transition hover:text-ivory">Shipping &amp; Returns</Link>
            <span className="flex items-center">
              <span aria-hidden="true" className="mx-4 text-gold/45 sm:mx-5">|</span>
              <Link href="/privacy-policy" className="font-semibold text-gold transition hover:text-ivory">Privacy Policy</Link>
            </span>
            <span className="flex items-center">
              <span aria-hidden="true" className="mx-4 text-gold/45 sm:mx-5">|</span>
              <Link href="/legal" className="font-semibold text-gold transition hover:text-ivory">Terms &amp; Legal</Link>
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}
