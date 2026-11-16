import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AccountStatus, type Role } from '../../database/schema';
import { Errors } from '../errors';
import { INSTITUTION_EMAIL_SUFFIX, isInstitutionEmail } from '../../config/env';
import {
  ALLOW_SUSPENDED_KEY,
  IS_PUBLIC_KEY,
  REQUIRES_VERIFIED_STUDENT_KEY,
  ROLES_KEY,
} from '../decorators/auth.decorators';
import { AUTH_USER_KEY, type RequestWithUser } from '../decorators/current-user.decorator';

/**
 * Runs after `SessionGuard` and answers the second question: may this caller do
 * this?
 *
 * Three rules, each read from the marker the controller put on itself:
 * a suspended account is out (except on sign-out, which `@AllowSuspended()`
 * exists for), a route with `@Roles(...)` needs one of those roles, and a route
 * with `@VerifiedStudent()` needs a confirmed AIUB student address.
 *
 * The role and the verification flags come from the database row the session
 * resolved to, never from anything the caller sent, so a request cannot claim a
 * role it was not given. Handlers can therefore assume that whoever reached
 * them was allowed to.
 */
@Injectable()
export class AuthzGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets);
    const roles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, targets);
    const requiresVerified = this.reflector.getAllAndOverride<boolean>(
      REQUIRES_VERIFIED_STUDENT_KEY,
      targets,
    );
    const allowSuspended = this.reflector.getAllAndOverride<boolean>(ALLOW_SUSPENDED_KEY, targets);
    const user = context.switchToHttp().getRequest<RequestWithUser>()[AUTH_USER_KEY];

    if (!user) {
      // `SessionGuard` has already refused anonymous traffic on every route that
      // is not `@Public()`, so the only way here is a public page — and a public
      // page needs nothing. The throw is the backstop that keeps `@Roles()` and
      // `@VerifiedStudent()` honest if that ever changes.
      if (isPublic) return true;
      throw Errors.authenticationRequired();
    }

    if (user.status === AccountStatus.SUSPENDED && !allowSuspended) {
      throw new ForbiddenException({
        code: 'ACCOUNT_SUSPENDED',
        message: 'Account is suspended',
      });
    }

    if (roles?.length && !roles.includes(user.role)) {
      throw new ForbiddenException({
        code: 'INSUFFICIENT_ROLE',
        message: `Requires role: ${roles.join(' or ')}`,
      });
    }

    if (requiresVerified) {
      if (!user.emailVerified) {
        throw new ForbiddenException({
          code: 'EMAIL_NOT_VERIFIED',
          message: 'Verify your institutional e-mail to use student services',
        });
      }
      // Read from `src/config/env.ts`, not from the database: this is
      // the check that decides whether an account may reach another student, so
      // the answer should come from the same reviewed file the administrator
      // list comes from, and not from a row somebody could edit.
      if (!isInstitutionEmail(user.email)) {
        throw new ForbiddenException({
          code: 'UNAPPROVED_DOMAIN',
          message: `Only ${INSTITUTION_EMAIL_SUFFIX} addresses may use student services`,
        });
      }
    }

    return true;
  }
}
