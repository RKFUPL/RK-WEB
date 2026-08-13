import { LegalPage } from '@/components/site/legal-page';
import { legalPages } from '@/lib/legal-content';
import { pageMetadata } from '@/lib/site-metadata';

export const metadata = pageMetadata('Rashi Kapoor — Cookies', 'How cookies and similar technologies support the Rashi Kapoor website.', '/cookies');
export default function CookiesPage() { const page = legalPages.cookies; return <LegalPage eyebrow="Rashi Kapoor / Policies" {...page} />; }
