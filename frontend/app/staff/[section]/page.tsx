import { OperationsSection } from '@/components/staff/operations-section';

export default async function StaffSection({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  return <OperationsSection section={section} />;
}
