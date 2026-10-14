import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { sessionSchema, type Session } from '@tradeflow/shared';
import { ApiError, createApiClient } from './api';

/**
 * The session cookie.
 *
 * The token is httpOnly, so no script on the page can read it — the browser can
 * only spend it by asking the server, which means the token cannot leak through
 * an XSS in a dependency. It is also `sameSite: lax`, which is what allows the
 * customer's public quote link to work when it is opened from an email.
 */
export const TOKEN_COOKIE = 'tf_token';

const EIGHT_HOURS_SECONDS = 60 * 60 * 8;

export async function getToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(TOKEN_COOKIE)?.value ?? null;
}

/**
 * An authenticated client, or a redirect to the sign-in screen.
 *
 * Every page under the `(app)` group calls this; the bare `/q/[token]` page and
 * the sign-in screen do not, which is what makes the customer's link work
 * without an account.
 */
export async function requireClient() {
  const token = await getToken();
  if (!token) redirect('/login');
  return createApiClient(token);
}

/**
 * The principal behind the cookie, verified against the API rather than decoded
 * locally: a token that was revoked or signed with a rotated key must stop
 * working, and only the API can say that.
 *
 * `cache` collapses the layout's read and the page's read into one request per
 * navigation.
 */
export const getSession = cache(async (): Promise<Session | null> => {
  const token = await getToken();
  if (!token) return null;

  try {
    const payload = await createApiClient(token).get<unknown>('/auth/session');
    const parsed = sessionSchema.safeParse(payload);
    return parsed.success ? parsed.data : null;
  } catch (error) {
    // A rejected token is "signed out". A transport failure is also "we cannot
    // prove you are signed in", which is the same answer to the same question.
    if (error instanceof ApiError) return null;
    throw error;
  }
});

export async function setSessionCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(TOKEN_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: EIGHT_HOURS_SECONDS,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(TOKEN_COOKIE);
}
