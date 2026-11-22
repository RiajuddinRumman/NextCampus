import { IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
import { isPresent } from '../../../common/validators/is-present';

/**
 * How long the two identity fields on the account row may be.
 *
 * Exported because the ceiling is not this route's private rule: the `users`
 * columns are plain `text`, so nothing in the database would notice a five
 * thousand character name, and `PATCH /api/admin/users/:id/profile` writes the
 * same two columns through a body this pipe never sees. Both places read these
 * numbers so the two cannot disagree about what a name is.
 */
export const MAX_NAME_LENGTH = 120;
export const MAX_DEPARTMENT_LENGTH = 120;

/**
 * Body of `PATCH /api/users/me`.
 *
 * Every field is optional because this is a partial update — but at least one
 * has to carry something, otherwise an empty request would be recorded as an
 * edit; `UsersService.updateProfile` answers `NO_FIELDS`. `role`, `status` and
 * `email` are missing on purpose: an account cannot promote itself, and the
 * validation pipe rejects any field that is not declared here. The same is true
 * of the institution — this platform serves one, named in
 * `src/config/env.ts`, so it is a fact about the deployment rather than
 * a value a student edits.
 *
 * A field sent as `null` clears the value; a field left out is untouched. That
 * distinction is why most of these are typed `string | null`, and why the "at
 * least one" check looks at the values rather than at how many keys arrived.
 *
 * `name` is the one field that cannot be cleared — the account row declares it
 * `NOT NULL` — so it takes `@ValidateIf(isPresent)` instead of `@IsOptional()`:
 * absent still means untouched, but `{"name": null}` is refused with
 * `VALIDATION_FAILED` naming `name` rather than reaching the update and failing
 * on the column.
 */
export class UpdateProfileDto {
  @ValidateIf(isPresent)
  @IsString()
  @MaxLength(MAX_NAME_LENGTH)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(600)
  bio?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_DEPARTMENT_LENGTH)
  department?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(600)
  image?: string | null;

  // The next three live on the separate profile document rather than on the
  // account row; `null` clears them, they are never deleted.
  @IsOptional()
  @IsString()
  @MaxLength(140)
  headline?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  about?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(400)
  interests?: string | null;

  /**
   * Stored but never rendered publicly; it is disclosed only when the owner
   * accepts an inquiry and chooses to share it.
   */
  @IsOptional()
  @IsString()
  @MaxLength(160)
  privateContact?: string | null;
}
