import { LegalPage } from '@/components/site/legal-page';
import { legalPages } from '@/lib/legal-content';
import { pageMetadata } from '@/lib/site-metadata';

export const metadata = pageMetadata('Legal', 'Terms, product information, customisation and legal notices for Rashi Kapoor.', '/legal');
export default function Page() { return <LegalPage eyebrow="Rashi Kapoor / Policies" updated="08 October 2026" {...legalPages.legal} />; }
