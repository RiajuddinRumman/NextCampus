import { SetMetadata } from '@nestjs/common';
import type { Role } from '../../database/schema';

/** Metadata keys, namespaced so nothing else in the project can collide with them. */
export const IS_PUBLIC_KEY = 'scsp:isPublic';
export const REQUIRES_VERIFIED_STUDENT_KEY = 'scsp:requiresVerifiedStudent';
export const ROLES_KEY = 'scsp:roles';
export const ALLOW_SUSPENDED_KEY = 'scsp:allowSuspended';

/**
 * Says, out loud, who may call this route.
 *
 * The four markers below are read by the two guards registered in
 * `../../app.module.ts` — `SessionGuard` (who is calling?) and `AuthzGuard`
 * (may they do this?) — before the handler runs. Only `@Public()` changes
 * whether a session is needed: every route without it is refused anonymously,
 * so forgetting a marker fails closed rather than leaving a route open. What
 * the other three decide is what a caller who _is_ signed in may do.
 */

/** Callable without a session. The only marker that opens a route to anonymous traffic. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Requires a verified e-mail on the institution's own domain. */
export const VerifiedStudent = () => SetMetadata(REQUIRES_VERIFIED_STUDENT_KEY, true);

/** Restricts a route to the given roles. Implies authentication. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

/** Skips the suspended-account block (used by sign-out). */
export const AllowSuspended = () => SetMetadata(ALLOW_SUSPENDED_KEY, true);
