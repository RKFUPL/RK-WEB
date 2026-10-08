import { LegalPage } from '@/components/site/legal-page';
import { legalPages } from '@/lib/legal-content';
import { pageMetadata } from '@/lib/site-metadata';

export const metadata = pageMetadata('Shipping & Returns', 'Production, delivery, returns and cancellation information for Rashi Kapoor orders.', '/shipping-returns');
export default function Page() { return <LegalPage eyebrow="Rashi Kapoor / Policies" updated="08 October 2026" {...legalPages.shippingReturns} />; }
