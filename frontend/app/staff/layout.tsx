import type { ReactNode } from 'react';
import { DashboardShell } from '@/components/dashboard-shell';
import { RbacGuard } from '@/components/rbac-guard';

export default function StaffLayout({ children }: { children: ReactNode }) {
  return <RbacGuard role="staff"><DashboardShell role="staff" title="Operations">{children}</DashboardShell></RbacGuard>;
}
