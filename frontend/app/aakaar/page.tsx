import { AakaarPage } from '@/components/aakaar-page';
import { pageMetadata } from '@/lib/site-metadata';

export const metadata = pageMetadata(
  'Aakaar | Coming Soon',
  'A preview of Aakaar, the debut collection from Rashi Kapoor.',
  '/aakaar',
);

export default function AakaarRoute() {
  return <AakaarPage />;
}
