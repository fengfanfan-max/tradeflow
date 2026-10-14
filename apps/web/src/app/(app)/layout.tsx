import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { AppShell } from '@/components/app-shell';
import { getSession } from '@/lib/session';

/**
 * Everything inside this group needs a session.
 *
 * The check is against `/auth/session` rather than against the cookie's
 * presence: a cookie that exists but was revoked, or was signed with a rotated
 * key, is not a session, and treating it as one would render an app shell full
 * of failing requests.
 *
 * This is the only access rule in the app. The two routes outside the group —
 * `/login` and `/q/[token]` — are public by construction rather than by an
 * exemption list.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/login');

  return <AppShell session={session}>{children}</AppShell>;
}
