import { CustomerOrdersPage } from '@/components/orders/customer-orders-page';
import { RbacGuard } from '@/components/rbac-guard';

export default function AccountOrdersRoute() {
  return <RbacGuard role="customer"><CustomerOrdersPage /></RbacGuard>;
}

