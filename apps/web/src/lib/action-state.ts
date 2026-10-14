/**
 * What a server action hands back to the form that called it.
 *
 * Errors are *returned*, not thrown. A thrown error crossing the server/client
 * boundary is redacted to a generic message in production, which would leave the
 * operator staring at "Something went wrong" when the API had in fact said
 * exactly which field was wrong, or that the record had moved on.
 *
 * This module is deliberately free of any import that touches the network or
 * `next/headers`, because the client component that renders the result imports
 * it too.
 */

import type { DraftQuoteResponse, Problem } from '@tradeflow/shared';

export interface ActionFailure {
  ok: false;
  problem: Problem;
}

export interface ActionSuccess {
  ok: true;
  /** Optional confirmation for actions that stay on the page. */
  message?: string;
}

export type ActionState = ActionSuccess | ActionFailure | null;

export type DraftState =
  | { ok: true; data: DraftQuoteResponse }
  | { ok: false; problem: Problem }
  | null;

export const IDLE: ActionState = null;

export function fail(problem: Problem): ActionFailure {
  return { ok: false, problem };
}

export function failWith(code: string, message: string, fields?: Record<string, string>): ActionFailure {
  return fail({ statusCode: 400, code, message, ...(fields ? { fields } : {}) });
}

export function succeed(message?: string): ActionSuccess {
  return message ? { ok: true, message } : { ok: true };
}

/**
 * Read the `Problem` off a thrown error without importing the API client.
 *
 * A structural check rather than `instanceof ApiError`: the client module reads
 * `process.env` at load and must stay out of the browser graph, and across a
 * bundler boundary `instanceof` is not reliable anyway.
 */
export function problemFrom(error: unknown): Problem {
  if (error && typeof error === 'object' && 'problem' in error) {
    const candidate = (error as { problem?: unknown }).problem;
    if (
      candidate &&
      typeof candidate === 'object' &&
      typeof (candidate as Problem).code === 'string' &&
      typeof (candidate as Problem).message === 'string'
    ) {
      return candidate as Problem;
    }
  }

  return {
    statusCode: 500,
    code: 'INTERNAL_ERROR',
    message: error instanceof Error ? error.message : 'Something went wrong.',
  };
}

/** A 409 the operator can only resolve by seeing the current record. */
export function isStaleWrite(problem: Problem): boolean {
  return problem.code === 'STALE_WRITE';
}
