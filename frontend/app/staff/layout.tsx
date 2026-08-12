import type { ReactNode } from 'react';
import { DashboardShell } from '@/components/dashboard-shell';
import { RbacGuard } from '@/components/rbac-guard';
import { pageMetadata } from '@/lib/site-metadata';

export const metadata = pageMetadata('Staff Workspace', 'Private Rashi Kapoor staff workspace.', '/staff', { index: false });

export default function StaffLayout({ children }: { children: ReactNode }) {
  return <RbacGuard role="staff"><DashboardShell role="staff" title="Operations">{children}</DashboardShell></RbacGuard>;
}
