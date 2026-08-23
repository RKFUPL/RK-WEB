import { ProductDetailPage } from '@/components/products/product-detail-page';
import { pageMetadata } from '@/lib/site-metadata';

export const metadata = pageMetadata('Runway Piece', 'Discover a Rashi Kapoor Lakme runway piece.', '/runway/LFW');

export default async function RunwayProductPage({ params }: { params: Promise<{ product: string }> }) {
  const { product } = await params;
  return <ProductDetailPage productId={product} />;
}
