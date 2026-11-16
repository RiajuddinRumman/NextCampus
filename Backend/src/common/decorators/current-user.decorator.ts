import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthUser } from '../../modules/auth/session.service';
import { Errors } from '../errors';

export const AUTH_USER_KEY = 'scsp:user';

export type RequestWithUser = Request & { [AUTH_USER_KEY]?: AuthUser };

function userOf(ctx: ExecutionContext): AuthUser | undefined {
  return ctx.switchToHttp().getRequest<RequestWithUser>()[AUTH_USER_KEY];
}

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const user = userOf(ctx);
  if (!user) throw Errors.authenticationRequired();
  return user;
});

export const OptionalCurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser | null => userOf(ctx) ?? null,
);
