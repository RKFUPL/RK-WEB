import { ProductDetailPage } from '@/components/products/product-detail-page';
import { pageMetadata } from '@/lib/site-metadata';

export const metadata = pageMetadata('Collection Piece', 'Discover a Rashi Kapoor collection piece.', '/products');

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProductDetailPage productId={id} />;
}
