import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { loginAction } from '@/lib/actions/auth';
import { ActionForm } from '@/components/action-form';
import { getSession } from '@/lib/session';

export const metadata: Metadata = { title: 'Sign in' };

export default async function LoginPage() {
  // Already holding a token the API still accepts; there is nothing to do here.
  if (await getSession()) redirect('/');

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6">
          <span
            aria-hidden
            className="mb-4 flex h-9 w-9 items-center justify-center rounded-md bg-accent text-base font-bold text-accent-ink"
          >
            T
          </span>
          <h1 className="text-xl font-semibold tracking-tight text-ink">Sign in to Tradeflow</h1>
          <p className="mt-1 text-sm text-ink-dim">Customers, quotes, jobs and invoices in one place.</p>
        </div>

        <div className="panel p-5">
          <ActionForm action={loginAction} submitLabel="Sign in" pendingLabel="Signing in…" submitClassName="btn btn-primary w-full">
            <div>
              <label className="label" htmlFor="email">
                Work email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                className="control"
                autoComplete="username"
                required
                autoFocus
                placeholder="you@example.co.uk"
              />
            </div>
            <div>
              <label className="label" htmlFor="password">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                className="control"
                autoComplete="current-password"
                required
                minLength={8}
              />
            </div>
          </ActionForm>
        </div>

        <p className="mt-4 text-center text-xs text-ink-faint">
          The API is expected at <span className="num">http://localhost:3001</span>. Run{' '}
          <span className="num">pnpm dev:api</span> if sign-in cannot reach it.
        </p>
        <p className="mt-2 text-center text-xs text-ink-faint">
          <Link className="link underline decoration-line-strong" href="/">
            Continue to the dashboard
          </Link>
        </p>
      </div>
    </main>
  );
}
