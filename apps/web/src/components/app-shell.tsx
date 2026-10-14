import Link from 'next/link';
import { headers } from 'next/headers';
import type { ReactNode } from 'react';
import type { Session } from '@tradeflow/shared';
import { logoutAction } from '@/lib/actions/auth';

/**
 * The application chrome.
 *
 * Dense and quiet on purpose: a monospaced-width rail with one accent for the
 * current section, so the eye lands on the table rather than on the navigation.
 * The active item comes from the `x-pathname` header the middleware sets — a
 * server component cannot otherwise know where it is, and a `usePathname` client
 * component would spend one of the two client slots on a menu highlight.
 */

interface NavItem {
  href: string;
  label: string;
  /** Only the dashboard matches exactly; everything else owns a subtree. */
  exact?: boolean;
}

const NAV: NavItem[] = [
  { href: '/', label: 'Today', exact: true },
  { href: '/jobs', label: 'Jobs' },
  { href: '/quotes', label: 'Quotes' },
  { href: '/invoices', label: 'Invoices' },
  { href: '/customers', label: 'Customers' },
  { href: '/price-book', label: 'Price book' },
];

function isActive(pathname: string, item: NavItem): boolean {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

export async function AppShell({
  session,
  children,
}: {
  session: Session;
  children: ReactNode;
}) {
  const headerList = await headers();
  const pathname = headerList.get('x-pathname') ?? '/';
  const initial = session.tenant.name.slice(0, 1).toUpperCase();

  return (
    <div className="min-h-screen md:flex">
      <aside className="md:sticky md:top-0 md:h-screen md:w-52 md:shrink-0 md:border-r md:border-line md:bg-surface">
        <div className="flex items-center gap-2.5 px-4 py-4">
          <span
            aria-hidden
            className="flex h-7 w-7 items-center justify-center rounded-md bg-accent text-sm font-bold text-accent-ink"
          >
            {initial}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-ink">{session.tenant.name}</span>
            <span className="block truncate text-[11px] text-ink-faint">Tradeflow</span>
          </span>
        </div>

        <nav aria-label="Sections" className="px-2 pb-2">
          <ul className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
            {NAV.map((item) => {
              const active = isActive(pathname, item);
              return (
                <li key={item.href} className="shrink-0 md:shrink">
                  <Link
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={`block rounded-md px-3 py-1.5 text-sm transition-colors ${
                      active
                        ? 'bg-accent-wash font-medium text-accent'
                        : 'text-ink-dim hover:bg-hover hover:text-ink'
                    }`}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="mt-auto hidden border-t border-line px-4 py-3 md:block">
          <p className="truncate text-xs font-medium text-ink">{session.user.name}</p>
          <p className="truncate text-[11px] text-ink-faint">{session.user.email}</p>
          <p className="mt-1 text-[11px] tracking-wide text-ink-faint uppercase">{session.user.role}</p>
          <form action={logoutAction} className="mt-2">
            <button type="submit" className="btn btn-ghost btn-sm w-full justify-start px-0">
              Sign out
            </button>
          </form>
        </div>
      </aside>

      <main className="min-w-0 flex-1">
        <div className="mx-auto max-w-[1400px] px-4 py-6 md:px-6">{children}</div>
      </main>
    </div>
  );
}
