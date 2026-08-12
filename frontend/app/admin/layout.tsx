import type { ReactNode } from 'react';
import { DashboardShell } from '@/components/dashboard-shell';
import { RbacGuard } from '@/components/rbac-guard';
import { pageMetadata } from '@/lib/site-metadata';

export const metadata = pageMetadata('Admin Workspace', 'Private Rashi Kapoor administration workspace.', '/admin', { index: false });

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <RbacGuard role="admin"><DashboardShell role="admin" title="Control room">{children}</DashboardShell></RbacGuard>;
}
