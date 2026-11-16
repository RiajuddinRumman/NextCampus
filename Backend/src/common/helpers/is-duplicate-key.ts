import { QueryFailedError } from 'typeorm';

const UNIQUE_VIOLATION = '23505';

export function isDuplicateKey(error: unknown): boolean {
  return (
    error instanceof QueryFailedError &&
    (error as QueryFailedError & { code?: string }).code === UNIQUE_VIOLATION
  );
}
