import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SessionService, type AuthUser } from '../../modules/auth/session.service';
import { Errors } from '../errors';
import { IS_PUBLIC_KEY } from '../decorators/auth.decorators';
import { AUTH_USER_KEY, type RequestWithUser } from '../decorators/current-user.decorator';

/**
 * The first guard on every route, and it answers one question: who is calling?
 *
 * It reads the session cookie — or an `Authorization: Bearer` token, which is
 * how a non-browser client signs in — has `SessionService` check the signature
 * and then the `sessions` row, and attaches the account it found to the request
 * for `@CurrentUser()` to read.
 *
 * It never decides *whether that caller may do this*; that is `AuthzGuard`,
 * which runs after it. Splitting the two questions is why the identity lookup
 * happens once per request even though the permission rules differ per route.
 *
 * Two rules a newcomer should be able to rely on:
 *
 * - A route is protected unless it says `@Public()`. Forgetting a marker makes
 *   the route refuse anonymous traffic, which is the safe direction to be wrong
 *   in — there is no way to leave a student-only endpoint open by accident.
 * - On a `@Public()` route, a credential that does not resolve is treated as no
 *   credential at all, so a stale cookie cannot break a page anyone may read.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const request = context.switchToHttp().getRequest<RequestWithUser>();

    const user = await this.resolve(request, isPublic);
    if (user) request[AUTH_USER_KEY] = user;
    else if (!isPublic) throw Errors.authenticationRequired();
    return true;
  }

  /** The account behind this request's credential, or nobody when there is none. */
  private async resolve(
    request: RequestWithUser,
    isPublic: boolean | undefined,
  ): Promise<AuthUser | undefined> {
    try {
      return await this.sessions.readUser({
        cookie: request.headers.cookie,
        authorization: request.headers.authorization,
      });
    } catch (error) {
      if (isPublic) return undefined;
      // `readUser` has already named the reason a presented credential failed;
      // anything else that went wrong while reading it is not the caller's
      // business, and lands as the same invalid-session answer.
      if (error instanceof UnauthorizedException) throw error;
      throw Errors.invalidSession();
    }
  }
}
