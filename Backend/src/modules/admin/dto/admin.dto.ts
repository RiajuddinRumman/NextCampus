import { Transform, Type } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { toLowerCase } from '../../../common/validators/lowercase-transform';
import type { User } from '../../../database/entities/index';
import { AccountStatus, Role } from '../../../database/schema';

/** The three roles this platform knows, in the order the enum declares them. */
export const PLATFORM_ROLES = Object.values(Role);

/**
 * The roles an administrator can hand out. ADMIN is missing, and that is the
 * point: administrators are rows an operator inserts with SQL of their own, so no
 * route can create another. Were it grantable, one stolen admin session would be
 * enough to add an untraceable administrator whose audit row says only that
 * somebody with a legitimate session asked.
 *
 * Spelled out rather than filtered from `PLATFORM_ROLES` so a future role has to
 * be decided about here. The search filter below still accepts ADMIN — reading the
 * roster is not changing it.
 */
export const ASSIGNABLE_ROLES = [Role.USER, Role.MODERATOR] as const;
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

/**
 * Body of `PATCH /api/admin/users/:id/role`. The reason is mandatory because the
 * role change is logged: "who made this person a moderator, and why" stays
 * answerable from that row alone.
 */
export class AssignRoleDto {
  @IsIn(ASSIGNABLE_ROLES)
  role!: AssignableRole;

  @IsString()
  @Length(5, 2000)
  reason!: string;
}

/**
 * Body of `POST /api/admin/users` — the exception path, for a real institutional
 * address whose mailbox cannot be reached. The account starts verified and the
 * reason is required because the administrator signing it *is* the proof.
 *
 * `password` is temporary and handed over in person; `role` cannot be ADMIN.
 */
export class CreatePlatformUserDto {
  @IsString()
  @Length(2, 120)
  name!: string;

  @Transform(toLowerCase)
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;

  @IsOptional()
  @IsIn(ASSIGNABLE_ROLES)
  role?: AssignableRole;

  @IsString()
  @Length(5, 2000)
  reason!: string;

  @IsOptional()
  @IsString()
  @Length(2, 120)
  department?: string;
}

/** Body of `POST /api/admin/users/:id/remove`. */
export class RemoveUserDto {
  @IsString()
  @Length(5, 2000)
  reason!: string;
}

/**
 * Body of `POST /api/admin/users/:id/verify`. `@IsString()` with no length rule,
 * unlike `RemoveUserDto`: how short is too short is decided by
 * `AdminService.markEmailVerified()`, which answers `REASON_REQUIRED` — a pipe
 * would answer `VALIDATION_FAILED` for the same mistake, giving the audit trail
 * two codes for one thing. The type check stops `{ reason: {} }` reaching the log
 * as the text `[object Object]`.
 */
export class VerifyUserDto {
  @IsString()
  reason!: string;
}

/**
 * Query for `GET /api/admin/users`. `verified` and `status` arrive as text in a
 * query string, so they are validated against the exact words and coerced to what
 * the service expects. Page size is capped tighter than the public endpoints (50,
 * not 100) because an admin row carries more data than a listing card.
 */
export class SearchUsersQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  @IsOptional()
  @IsIn(PLATFORM_ROLES)
  role?: Role;

  @IsOptional()
  @IsIn(Object.values(AccountStatus))
  status?: AccountStatus;

  @IsOptional()
  @IsIn(['true', 'false'])
  verified?: 'true' | 'false';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 20;
}

/**
 * The columns an admin sees about a student — `email` because the administrator is
 * the one who has to contact them, and no `passwordHash` because nobody reads it.
 */
export interface AdminUserRow {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  role: Role;
  status: AccountStatus;
  department: string | null;
  createdAt: Date;
}

export function toAdminRow(user: User): AdminUserRow {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    emailVerified: user.emailVerified,
    role: user.role,
    status: user.status,
    department: user.department,
    createdAt: user.createdAt,
  };
}
