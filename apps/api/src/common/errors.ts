/**
 * Domain errors.
 *
 * Services throw these; the exception filter turns them into the `Problem`
 * shape defined in packages/shared. Keeping the two separate is what lets the
 * service layer read as business rules rather than as HTTP plumbing.
 *
 * Every error carries a stable `code`. The web client switches on the code, so
 * a message can be reworded — or translated — without breaking behaviour.
 */

export class DomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends DomainError {
  constructor(message: string, fields?: Record<string, string>) {
    super('VALIDATION_FAILED', message, 400, fields);
  }
}

export class UnauthorizedError extends DomainError {
  constructor(message = 'Authentication required.') {
    super('UNAUTHENTICATED', message, 401);
  }
}

export class ForbiddenError extends DomainError {
  constructor(message = 'You do not have access to this resource.') {
    super('FORBIDDEN', message, 403);
  }
}

/**
 * Used for a record that exists but belongs to another tenant, as well as for
 * one that does not exist at all — deliberately.
 *
 * Returning 403 for the first case would confirm that the id is real, which is
 * an enumeration oracle across tenant boundaries. Both answer 404.
 */
export class NotFoundError extends DomainError {
  constructor(what: string) {
    super('NOT_FOUND', `${what} not found.`, 404);
  }
}

export class ConflictError extends DomainError {
  constructor(code: string, message: string, fields?: Record<string, string>) {
    super(code, message, 409, fields);
  }
}

/**
 * A write that lost an optimistic-concurrency race.
 *
 * Distinct from ConflictError so the client can offer "reload and reapply"
 * rather than a generic failure, and so the e2e suite can assert on it.
 */
export class StaleWriteError extends ConflictError {
  constructor(readonly currentVersion: number) {
    super(
      'STALE_WRITE',
      'This record changed since you loaded it. Reload to see the current version before saving.',
      { expectedVersion: 'stale' },
    );
  }
}

/**
 * A schedule clash.
 *
 * Carries the conflicting job so the UI can say "already booked 09:00–11:00"
 * rather than just refusing.
 */
export class ScheduleConflictError extends ConflictError {
  constructor(readonly conflictingJob: { id: string; number: string; scheduledStart: Date; scheduledEnd: Date }) {
    super(
      'SCHEDULE_CONFLICT',
      `That engineer is already booked on ${conflictingJob.number}.`,
      { scheduledStart: 'overlaps an existing job' },
    );
  }
}

/**
 * A state transition the domain does not allow.
 *
 * Separate code because the UI handles it differently from a validation error:
 * it means the page is showing a state the server has already moved past.
 */
export class InvalidTransitionError extends DomainError {
  constructor(from: string, to: string, allowed: readonly string[]) {
    super(
      'INVALID_TRANSITION',
      `Cannot move from ${from} to ${to}. Allowed: ${allowed.join(', ') || 'none'}.`,
      409,
    );
  }
}
