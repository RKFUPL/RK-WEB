import { CustomerOrderDetail } from '@/components/orders/customer-order-detail';
import { RbacGuard } from '@/components/rbac-guard';

export default async function AccountOrderRoute({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  return <RbacGuard role="customer"><CustomerOrderDetail orderId={orderId} /></RbacGuard>;
}
