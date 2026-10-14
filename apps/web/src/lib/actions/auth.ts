'use server';

import { redirect } from 'next/navigation';
import { loginRequestSchema } from '@tradeflow/shared';
import { createApiClient } from '@/lib/api';
import { fail, problemFrom, type ActionState } from '@/lib/action-state';
import { clearSessionCookie, setSessionCookie } from '@/lib/session';
import { login } from '@/lib/resources';
import { text, validationProblem } from './shared';

export async function loginAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = loginRequestSchema.safeParse({
    email: text(formData, 'email'),
    password: text(formData, 'password'),
  });

  if (!parsed.success) return fail(validationProblem(parsed.error));

  let token: string;
  try {
    const result = await login(createApiClient(null), parsed.data);
    token = result.token;
  } catch (error) {
    return fail(problemFrom(error));
  }

  await setSessionCookie(token);

  // Outside the try: `redirect` signals by throwing, and catching it here would
  // turn a successful sign-in into an error message.
  redirect('/');
}

export async function logoutAction(): Promise<void> {
  await clearSessionCookie();
  redirect('/login');
}
