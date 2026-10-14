import Link from 'next/link';

/**
 * Reached by `notFound()` when the API answers 404 — which, deliberately, is
 * also what it answers for a record belonging to another tenant. The page
 * therefore says "not here" rather than "does not exist", because the two are
 * indistinguishable from outside on purpose.
 */
export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-16">
      <div className="panel max-w-md p-6 text-center">
        <p className="num text-xs tracking-wider text-ink-faint uppercase">404</p>
        <h1 className="mt-2 text-lg font-semibold text-ink">Nothing here</h1>
        <p className="mt-2 text-sm text-ink-dim">
          That record may have been removed, or the link may be wrong.
        </p>
        <div className="mt-4 flex justify-center gap-2">
          <Link className="btn" href="/">
            Back to today
          </Link>
          <Link className="btn" href="/quotes">
            Quotes
          </Link>
        </div>
      </div>
    </main>
  );
}
