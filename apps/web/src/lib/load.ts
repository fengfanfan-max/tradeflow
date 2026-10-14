import type { Problem } from '@tradeflow/shared';
import { problemFrom } from './action-state';

/**
 * Read a page's data without taking the page down with it.
 *
 * A dashboard makes three independent API calls. If one of them fails, the
 * operator should still see the other two and a note about what is missing —
 * a thrown error inside a server component replaces the whole route with an
 * error screen, which is a worse answer than a partial one. Errors are *not*
 * swallowed: `ok: false` carries the `Problem` to a panel that names it.
 */
export type Loaded<T> = { ok: true; data: T } | { ok: false; problem: Problem };

export async function load<T>(run: () => Promise<T>): Promise<Loaded<T>> {
  try {
    return { ok: true, data: await run() };
  } catch (error) {
    return { ok: false, problem: problemFrom(error) };
  }
}

export function loadedValue<T>(result: Loaded<T>, fallback: T): T {
  return result.ok ? result.data : fallback;
}
