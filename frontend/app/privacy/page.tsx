import { LegalPage } from '@/components/site/legal-page';
import { legalPages } from '@/lib/legal-content';
import { pageMetadata } from '@/lib/site-metadata';

export const metadata = pageMetadata('Rashi Kapoor — Privacy Policy', 'How Rashi Kapoor handles information connected with this website and its services.', '/privacy');
export default function PrivacyPage() { const page = legalPages.privacy; return <LegalPage eyebrow="Rashi Kapoor / Policies" {...page} />; }
