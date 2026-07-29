'use client';

import { brandLogoUrl } from '@/lib/home-content';
import { usePathname, useRouter } from 'next/navigation';

export function SiteHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const navItemClass =
    'border-0 bg-transparent p-0 font-body text-xs uppercase tracking-[0.28em] text-charcoal/70 transition hover:text-charcoal';

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
        <nav className="hidden gap-8 md:flex">
          <button
            type="button"
            onClick={() => {
              if (pathname !== '/') {
                router.push('/');
                window.setTimeout(() => {
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }, 100);
                return;
              }

              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
          className={navItemClass}
          >
            Home
          </button>
          <a href="/collections" className={navItemClass}>Collections</a>
          <a href="/rk-lookbooks" className={navItemClass}>Lookbook</a>
          <button type="button" onClick={scrollToAbout} className={navItemClass}>
            About
          </button>
          <button type="button" onClick={scrollToFooter} className={navItemClass}>
            Contact
          </button>
        </nav>
      </div>
    </header>
  );
}
