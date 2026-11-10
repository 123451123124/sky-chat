import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { RagWorkbench } from './RagWorkbench';
export default async function RagPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (user.role !== 'admin') redirect('/chat');
  return <RagWorkbench user={user} />;
}
