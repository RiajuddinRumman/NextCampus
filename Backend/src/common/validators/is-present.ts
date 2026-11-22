/**
 * The condition an optional DTO field needs when its column cannot hold null.
 *
 * `@IsOptional()` treats `null` as "no value" and skips the rest of the rules,
 * which is right for a nullable column and wrong for the other kind: a body of
 * `{"title": null}` then arrives at the service as a null, and the first
 * `.trim()` on it is a 500 with no code for the client to branch on.
 *
 * `@ValidateIf(isPresent)` keeps the two cases apart. Absent means "leave that
 * field alone" and no rule runs; present means it has to be a real value, so a
 * null falls through to the field's own `@IsString()`/`@IsArray()` and comes
 * back as `VALIDATION_FAILED` naming the path. A field whose column *is*
 * nullable keeps `@IsOptional()` and reads `null` as "clear it" — see
 * `UpdateListingDto`, which mixes the two on purpose.
 */
export function isPresent(_object: unknown, value: unknown): boolean {
  return value !== undefined;
}
