import { LegalPage } from '@/components/site/legal-page';
import { legalPages } from '@/lib/legal-content';
import { pageMetadata } from '@/lib/site-metadata';

export const metadata = pageMetadata('Rashi Kapoor — Security', 'How Rashi Kapoor approaches account, payment, website, and customer-data security.', '/security');
export default function SecurityPage() { const page = legalPages.security; return <LegalPage eyebrow="Rashi Kapoor / Policies" {...page} />; }
