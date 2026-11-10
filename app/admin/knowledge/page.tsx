import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { KnowledgeManager } from './KnowledgeManager';

export default async function KnowledgePage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (user.role !== 'admin') redirect('/chat');
  return <KnowledgeManager user={user} />;
}
