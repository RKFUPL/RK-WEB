import { CollectionManagementList } from '@/components/collections/collection-management-list';
import { OperationsSection } from '@/components/staff/operations-section';
import { OrderManagement } from '@/components/orders/order-management';

export default async function StaffSection({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  if (section === 'collections') return <CollectionManagementList basePath="/staff/collections" />;
  if (section === 'orders') return <OrderManagement />;
  return <OperationsSection section={section} />;
}
