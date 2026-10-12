import { ProductDetailPage } from '@/components/products/product-detail-page';
import { pageMetadata } from '@/lib/site-metadata';

export const metadata = pageMetadata('Collection Piece', 'Discover a Rashi Kapoor collection piece.', '/products');

export default async function ProductPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ variant?: string | string[] }> }) {
  const { id } = await params;
  const query = await searchParams;
  const initialVariantId = Array.isArray(query.variant) ? query.variant[0] : query.variant;
  return <ProductDetailPage productId={id} initialVariantId={initialVariantId || ''} />;
}
