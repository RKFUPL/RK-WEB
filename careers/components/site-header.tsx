import Link from 'next/link';

const mainSiteUrl = process.env.NEXT_PUBLIC_MAIN_SITE_URL || 'http://localhost:3000/';

export function SiteHeader() {
  return (
    <header className="site-header">
      <a href={mainSiteUrl} className="brand" aria-label="Return to Rashi Kapoor">
        <span className="brand-mark">RK</span>
        <span>Rashi Kapoor<br />Careers</span>
      </a>
      <nav aria-label="Careers navigation">
        <Link href="/">Home</Link>
        <Link href="/culture">Our culture</Link>
        <Link href="/opportunities">Opportunities</Link>
        <a href={mainSiteUrl}>Main house</a>
      </nav>
    </header>
  );
}
