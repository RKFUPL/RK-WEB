import type { ReactNode } from 'react';
import { DashboardShell } from '@/components/dashboard-shell';
import { RbacGuard } from '@/components/rbac-guard';

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <RbacGuard role="admin"><DashboardShell role="admin" title="Control room">{children}</DashboardShell></RbacGuard>;
}
