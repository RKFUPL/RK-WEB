'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Facebook, Instagram, Linkedin, Youtube } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { brandLogoUrl, featuredLooks, storeInteriorVideoUrl } from '@/lib/home-content';
import { CAREERS_URL } from '@/lib/external-links';

const footerColumns = [
  {
    title: 'Navigation',
    links: ['Collections', 'Lookbook', 'Runway', 'About'],
  },
  {
    title: 'Company',
    links: ['Careers', 'Contact', 'Sustainability'],
  },
  {
    title: 'Policies',
    links: ['Privacy', 'Terms', 'Cookies', 'Shipping', 'Security'],
  },
] as const;

const navigationHrefs: Record<string, string> = {
  Collections: '/collections',
  Lookbook: '/rk-lookbooks',
  Runway: '/runway',
  About: '/about',
};

// Update social destinations here when the final brand profiles are ready.
const socialLinks = {
  instagram: 'https://www.instagram.com/rashikapoorofficial/',
  pinterest: 'https://www.pinterest.com/',
  youtube: 'https://www.youtube.com/',
  facebook: 'https://www.facebook.com/',
  linkedin: 'https://www.linkedin.com/company/rashi-kapoor-fashion-unicus-private-limited/',
  x: 'https://x.com/',
} as const;

const footerSignatureLightImage = 'https://res.cloudinary.com/fm1bwbrd/image/upload/v1787059394/9bd32d0d-80c9-4607-8798-bec666a8e3ff.png';
const footerSignatureDarkImage = 'https://res.cloudinary.com/fm1bwbrd/image/upload/v1787059406/3c335991-6978-462c-a561-b3d1a23e11a0.png';

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

      <div className="mx-auto max-w-7xl px-6 py-16 lg:px-10 lg:py-20">
        <div className="grid gap-10 lg:grid-cols-[1.2fr_1fr]">
          <div className="space-y-4">
            <div className="inline-flex items-center justify-center px-4 py-3">
              <img
                src={brandLogoUrl}
                alt="RK Logo"
                width="92"
                height="48"
                className="footer-brand-mark h-12 w-auto"
              />
            </div>
            <p className="max-w-md font-display text-2xl leading-[1.08] text-ivory/90 md:text-3xl">
              Fashion is not just what you wear,<br /><em className="text-gold">it&apos;s a legacy you carry.</em>
            </p>
            <p className="max-w-md pt-3 text-sm leading-7 text-ivory/55">Rashi Kapoor luxury womenswear — where Indian craft is given a modern, enduring voice.</p>
            <a href="mailto:contact@rashikapoorofficial.com" className="inline-block pt-2 text-xs uppercase tracking-[0.22em] text-ivory/70 transition hover:text-gold">
              contact@rashikapoorofficial.com
            </a>
          </div>
          <div className="grid gap-8 sm:grid-cols-3">
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
                          <Link href="/about" aria-current={pathname === '/about' ? 'page' : undefined} className={`transition hover:text-gold ${pathname === '/about' ? 'text-gold' : ''}`}>
                            {link}
                          </Link>
                        ) : (
                          <Link
                            href={navigationHrefs[link]}
                            aria-current={pathname === navigationHrefs[link] ? 'page' : undefined}
                            className={`transition hover:text-gold ${pathname === navigationHrefs[link] ? 'text-gold' : ''}`}
                          >
                            {link}
                          </Link>
                        )
                      ) : column.title === 'Company' && link === 'Careers' ? (
                        <a href={CAREERS_URL} className="transition hover:text-gold">{link}</a>
                      ) : column.title === 'Company' && link === 'Contact' ? (
                        <a href="mailto:contact@rashikapoorofficial.com" className="transition hover:text-gold">{link}</a>
                      ) : (
                        <Link
                          href={`/${link.toLowerCase().replace(/\s+/g, '-')}`}
                          aria-current={pathname === `/${link.toLowerCase().replace(/\s+/g, '-')}` ? 'page' : undefined}
                          className={`transition hover:text-gold ${pathname === `/${link.toLowerCase().replace(/\s+/g, '-')}` ? 'text-gold' : ''}`}
                        >{link}</Link>
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

      <div className="flex flex-col items-center justify-between gap-4 border-t border-white/10 bg-[#0a0908] px-6 py-6 text-center text-ivory/45 sm:flex-row sm:px-10">
        <p className="text-[0.62rem] uppercase tracking-[0.2em]">© 2026 Rashi Kapoor Fashion Unicus Pvt. Ltd.</p>
        <img src={brandLogoUrl} alt="RK Logo" width="48" height="34" className="footer-brand-mark h-8 w-auto opacity-75" />
      </div>
      <div className="footer-signature-scene" aria-label="Rashi Kapoor signature artwork">
        <img src={footerSignatureLightImage} alt="Rashi Kapoor floral monogram" className="footer-signature-art footer-signature-light" />
        <img src={footerSignatureDarkImage} alt="Rashi Kapoor floral monogram" className="footer-signature-art footer-signature-dark" />
      </div>
    </footer>
  );
}
