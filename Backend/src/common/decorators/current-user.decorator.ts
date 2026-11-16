import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthUser } from '../../modules/auth/session.service';
import { Errors } from '../errors';

/** Where `SessionGuard` puts the account it resolved for this request. */
export const AUTH_USER_KEY = 'scsp:user';

/** The request as the guards leave it: an ordinary Express request, plus the caller. */
export type RequestWithUser = Request & { [AUTH_USER_KEY]?: AuthUser };

function userOf(ctx: ExecutionContext): AuthUser | undefined {
  return ctx.switchToHttp().getRequest<RequestWithUser>()[AUTH_USER_KEY];
}

/**
 * Gives the handler the account making the call.
 *
 * ```ts
 * @Get('me')
 * me(@CurrentUser() user: AuthUser) { ... }
 * ```
 *
 * The value is the row `SessionService.readUser()` built from the session the
 * presented credential resolved to — never anything the caller sent — so
 * `role`, `status` and `emailVerified` are facts about the account rather than
 * claims in the request. `AuthUser` holds no password hash by construction.
 */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const user = userOf(ctx);
  // Unreachable on a normal request: every route that reads this sits behind a
  // guard that refuses an absent caller before the handler runs. Throwing here
  // instead of returning `undefined` is what lets a handler parameter be typed
  // `AuthUser` rather than `AuthUser | undefined`.
  if (!user) throw Errors.authenticationRequired();
  return user;
});

/**
 * The same for `@Public()` routes that personalise themselves when a student
 * happens to be signed in — an owner sees the hidden state of their own
 * listing. No session, or one that no longer resolves, reads as `null`: a page
 * a student has not signed in to must not break over a cookie they forgot.
 */
export const OptionalCurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser | null => userOf(ctx) ?? null,
);
