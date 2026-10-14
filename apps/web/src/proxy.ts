import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

/**
 * The current path, for the navigation's active state.
 *
 * A server component cannot read the pathname, and the alternative — a
 * `usePathname` client component — would spend one of the two client-component
 * slots on highlighting a menu. Passing it as a request header costs nothing:
 * the layout already runs on every request because the data it fetches is
 * uncacheable.
 *
 * This is the only thing the proxy does. Authentication is checked in the
 * `(app)` layout against the API rather than here, because a proxy runs before
 * the token can be validated and a cookie merely existing is not proof that it
 * is still accepted.
 *
 * (`proxy.ts` is Next 16's name for what used to be `middleware.ts`.)
 */
export default function proxy(request: NextRequest): NextResponse {
  const headers = new Headers(request.headers);
  headers.set('x-pathname', request.nextUrl.pathname);

  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
