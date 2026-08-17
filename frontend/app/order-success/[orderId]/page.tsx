import { OrderSuccessPage } from '@/components/checkout/order-success-page';

export default async function OrderSuccessRoute({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  return <OrderSuccessPage orderId={orderId} />;
}
