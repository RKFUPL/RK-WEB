import { CollectionManagementDetail } from '@/components/collections/collection-management-detail';

export default async function AdminProductCollection({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <CollectionManagementDetail slug={slug} basePath="/admin/products" />;
}
