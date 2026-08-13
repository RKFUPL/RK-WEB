import { CollectionManagementList } from '@/components/collections/collection-management-list';
import { OperationsSection } from '@/components/staff/operations-section';

export default async function StaffSection({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  if (section === 'collections') return <CollectionManagementList basePath="/staff/collections" />;
  return <OperationsSection section={section} />;
}
