export class ValidationError extends Error {
  readonly statusCode = 400;
  readonly code = 'VALIDATION';
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends Error {
  readonly statusCode = 404;
  readonly code = 'NOT_FOUND';
  constructor(message = 'Transaction not found.') {
    super(message);
    this.name = 'NotFoundError';
  }
}

/**
 * The request was well-formed but the resource is not in a state that allows it.
 *
 * Currently raised only by `purge`, which refuses to hard-delete a transaction that is
 * still live. That refusal is the guard rail protecting real data from a mistyped id or
 * a mismatched UI state, so it is a distinct condition from "not found" and must not be
 * flattened into one.
 */
export class ConflictError extends Error {
  readonly statusCode = 409;
  readonly code = 'CONFLICT';
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}
