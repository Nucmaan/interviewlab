import {
  InvalidReadingError,
  InvalidTariffError,
  SegregationOfDutiesError,
  UnbalancedJournalError,
} from '@ircub/core';

/**
 * An expected business error whose message is safe to show to the user
 * ("This bill has already been released"). Anything else is treated as a bug: it is logged with
 * full detail, and the user only sees a generic message.
 */
export class DomainError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export class NotFoundError extends DomainError {
  constructor(what: string) {
    super(`${what} was not found`, 404);
    this.name = 'NotFoundError';
  }
}

/** Business errors from @ircub/core are also safe to show. */
export function isUserFacingError(error: unknown): error is Error {
  return (
    error instanceof DomainError ||
    error instanceof InvalidReadingError ||
    error instanceof InvalidTariffError ||
    error instanceof SegregationOfDutiesError ||
    error instanceof UnbalancedJournalError
  );
}
