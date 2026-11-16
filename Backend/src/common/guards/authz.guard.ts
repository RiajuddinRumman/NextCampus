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

// Role, then verified-student, then suspension. @AllowSuspended() is on sign-out alone.
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
