import { CollectionManagementDetail } from '@/components/collections/collection-management-detail';

export default async function StaffCollectionDetail({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <CollectionManagementDetail slug={slug} basePath="/staff/collections" />;
}
