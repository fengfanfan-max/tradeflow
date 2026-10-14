/**
 * URL as state.
 *
 * Every filter, sort and page lives in the query string so that an operator can
 * paste "the unpaid invoices for this customer" into a message and have it open
 * on the same view. That only holds if the links are built in one place, which
 * is what these helpers are for.
 */

export type RawSearchParams = Record<string, string | string[] | undefined>;

export function firstParam(params: RawSearchParams, key: string): string {
  const value = params[key];
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

export function optionalParam(params: RawSearchParams, key: string): string | undefined {
  const value = firstParam(params, key).trim();
  return value.length > 0 ? value : undefined;
}

export function intParam(params: RawSearchParams, key: string, fallback: number): number {
  const parsed = Number.parseInt(firstParam(params, key), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Only these values survive, so a hand-edited URL cannot inject a filter. */
export function enumParam<T extends string>(
  params: RawSearchParams,
  key: string,
  allowed: readonly T[],
): T | undefined {
  const value = firstParam(params, key);
  return (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

/**
 * A link to `pathname` with `patch` applied on top of the current query.
 *
 * `undefined` leaves a key alone — so a sort header keeps the active filters —
 * while `null` or `''` removes it. Frozen with sorted keys so that two links
 * that mean the same thing are the same string, which keeps Next's client cache
 * from missing on reordered parameters.
 */
export function buildHref(
  pathname: string,
  current: RawSearchParams,
  patch: Record<string, string | number | null | undefined> = {},
): string {
  const next = new URLSearchParams();

  for (const [key, value] of Object.entries(current)) {
    if (Array.isArray(value)) {
      if (value[0]) next.set(key, value[0]);
    } else if (value) {
      next.set(key, value);
    }
  }

  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (value === null || value === '') next.delete(key);
    else next.set(key, String(value));
  }

  next.sort();
  const query = next.toString();
  return query ? `${pathname}?${query}` : pathname;
}

/** Keeps `q` visible in the box without re-encoding it into a different string. */
export function searchValue(params: RawSearchParams, key = 'q'): string {
  return firstParam(params, key);
}

export function formatCount(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
