import { QueryFailedError } from 'typeorm';

/** PostgreSQL's "unique violation" code. */
const UNIQUE_VIOLATION = '23505';

/**
 * `true` when a write failed because the row it was making already exists.
 *
 * A check-then-insert pair is not atomic: two requests can both read "no row"
 * and both try to write, and only the second one learns about it from the
 * database. The services that care answer that loser with the same refusal they
 * give the caller who was caught by the readable check, so a race is a normal
 * 409 rather than a 500 nobody explained.
 *
 * Two routes need it (`POST /api/auth/complete-registration`, `POST /api/inquiries`).
 */
export function isDuplicateKey(error: unknown): boolean {
  return (
    error instanceof QueryFailedError &&
    (error as QueryFailedError & { code?: string }).code === UNIQUE_VIOLATION
  );
}
