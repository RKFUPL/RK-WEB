import { AdminOrderDetail } from '@/components/orders/admin-order-detail';

export default async function AdminOrderPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  return <AdminOrderDetail orderId={orderId} />;
}
