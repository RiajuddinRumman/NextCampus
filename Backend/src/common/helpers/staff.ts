import { Role } from '../../database/schema';
import type { AuthUser } from '../../modules/auth/session.service';

/**
 * The staff member a write route acts as — nothing more than who decided and
 * whether they were allowed to decide that.
 *
 * Services take this instead of the whole `AuthUser` on purpose. A moderation
 * method has no reason to be able to read a caller's e-mail address or their
 * account status, and a parameter that cannot hold them cannot be used by
 * accident.
 */
export interface StaffActor {
  id: string;
  role: Role;
}

/** The narrow view of a caller that a staff route is allowed to act on. */
export function toStaffActor(user: AuthUser): StaffActor {
  return { id: user.id, role: user.role };
}

/**
 * Whether a role is one of the two that see what a student cannot.
 *
 * Written once because the same pair of comparisons answered three separate
 * questions about a listing: may this viewer open a hidden row, may they search
 * someone else's closed catalogue, and do they get told which listings are
 * theirs in the private fields. A third staff role would otherwise have to be
 * added to every one of those comparisons.
 *
 * `undefined` is not staff, so an anonymous viewer answers `false` — which is
 * what the routes that take no session depend on.
 */
export function isStaff(role?: Role): boolean {
  return role === Role.MODERATOR || role === Role.ADMIN;
}

/**
 * Whether a role is the one that may take an account away.
 *
 * `@Roles(Role.ADMIN)` already refuses a moderator on these routes; this is the
 * same rule asked a second time inside the service, because a method that can
 * suspend somebody is a long way from the decorator that was supposed to
 * protect it.
 */
export function isAdmin(role?: Role): boolean {
  return role === Role.ADMIN;
}
