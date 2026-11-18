import { notFound } from 'next/navigation';
import OpsConsole from '@/components/ops/OpsConsole';
import { OPS_VIEW_IDS } from '@/lib/ops/views';

export default async function OpsViewPage({ params }: { params: Promise<{ view: string }> }) {
  const { view } = await params;
  if (!OPS_VIEW_IDS.includes(view)) notFound();
  return <OpsConsole view={view} />;
}
