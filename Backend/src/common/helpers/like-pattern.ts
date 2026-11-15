/**
 * The pattern for a "contains this text, ignoring case" search.
 *
 * The word a student typed goes between two `%` wildcards, but the characters
 * that *mean* something to `ILIKE` — backslash, `%`, `_` — are escaped first.
 * Without that, a search for `20%` would match every row in the table and a
 * listing titled `a_b` would answer to `ab`, so one honest character would buy
 * a page of unrelated results.
 *
 * Two services need it (listings search and the admin user search), so it
 * lives here rather than as a second copy someone forgets to update.
 */
export function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}
