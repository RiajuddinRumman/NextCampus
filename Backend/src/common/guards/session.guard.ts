import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SessionService, type AuthUser } from '../../modules/auth/session.service';
import { Errors } from '../errors';
import { IS_PUBLIC_KEY } from '../decorators/auth.decorators';
import { AUTH_USER_KEY, type RequestWithUser } from '../decorators/current-user.decorator';

// A signed token is necessary, not sufficient: the sessions row it points at must still exist and still be in date.
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
      if (error instanceof UnauthorizedException) throw error;
      throw Errors.invalidSession();
    }
  }
}
