/**
 * `true` when a PATCH body carries a field with a value in it.
 *
 * Every field of a patch DTO is optional, so `{}` is a valid request shape, and
 * without this check an empty update would be written, timestamped and returned
 * as if the student had edited something. The two routes that call it answer
 * `NO_FIELDS` and name their own fields in the message.
 *
 * A field sent as `null` asks the service to clear that one column, so it alone
 * does not make a body worth writing to the database — hence the values, not the
 * keys. `''`, `0` and `[]` are values, and `{ imageUrls: [] }` (drop every
 * picture) is an edit this accepts.
 *
 * Two update routes use it (`PATCH /api/users/me`, `PATCH /api/listings/:id`).
 */
export function hasPatchValues(dto: object): boolean {
  const values = Object.values(dto as Record<string, unknown>);
  return values.some((value) => value != null);
}
