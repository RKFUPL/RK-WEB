import { LegalPage } from '@/components/site/legal-page';
import { legalPages } from '@/lib/legal-content';
import { pageMetadata } from '@/lib/site-metadata';

export const metadata = pageMetadata('Rashi Kapoor — Terms of Use', 'Terms that apply when using the Rashi Kapoor website and services.', '/terms');
export default function TermsPage() { const page = legalPages.terms; return <LegalPage eyebrow="Rashi Kapoor / Policies" {...page} />; }
