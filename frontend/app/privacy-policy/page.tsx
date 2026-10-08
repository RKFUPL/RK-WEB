import { LegalPage } from '@/components/site/legal-page';
import { legalPages } from '@/lib/legal-content';
import { pageMetadata } from '@/lib/site-metadata';

export const metadata = pageMetadata('Privacy Policy', 'How Rashi Kapoor handles information connected with this website and its services.', '/privacy-policy');
export default function Page() { return <LegalPage eyebrow="Rashi Kapoor / Policies" updated="08 October 2026" {...legalPages.privacy} />; }
