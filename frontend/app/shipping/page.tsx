import { LegalPage } from '@/components/site/legal-page';
import { legalPages } from '@/lib/legal-content';
import { pageMetadata } from '@/lib/site-metadata';

export const metadata = pageMetadata('Rashi Kapoor — Shipping', 'Shipping information for Rashi Kapoor orders and delivery support.', '/shipping');
export default function ShippingPage() { const page = legalPages.shipping; return <LegalPage eyebrow="Rashi Kapoor / Client service" {...page} />; }
