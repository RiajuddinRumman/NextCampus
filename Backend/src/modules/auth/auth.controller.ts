import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { AllowSuspended, Public } from '../../common/decorators/auth.decorators';
import type { AuthUser } from './session.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { MAIL_THROTTLE, TOKEN_THROTTLE } from './auth.constants';
import { ChangePasswordDto,CompleteRegistrationDto,ForgotPasswordDto,ResetPasswordDto,SignInDto,SignUpDto,} from './dto/auth.dto';

/**
 * Registration and sign-in for students on the institution's own domain named in
 * `src/config/env.ts`.
 *
 * Registration is a pair: `POST /sign-up` asks the mailbox a question and
 * `POST /complete-registration` is the answer, taken only from the link the
 * mailbox received. Nothing is written between them, which stops a stranger
 * opening an account on somebody's roll number first.
 *
 * No response body contains a credential — the flows set or clear one httpOnly
 * `scsp.session` cookie that the SessionGuard reads, so the user stays signed in
 * while page scripts cannot read the value.
 *
 * Mailed links carry their token as `?token=` on the POST route that consumes it.
 * There is deliberately no GET route that consumes a token: mail clients follow
 * links automatically and would use one up before the student does.
 */
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @HttpCode(200)
  @Throttle({ default: MAIL_THROTTLE })
  @Post('sign-up')
  @ApiOperation({ summary: 'Ask for a registration link by e-mail' })
  signUp(@Body() body: SignUpDto) {
    return this.auth.signUp(body);
  }

  @Public()
  @HttpCode(201)
  @Throttle({ default: TOKEN_THROTTLE })
  @Post('complete-registration')
  @ApiOperation({ summary: 'Finish registration with the mailed token, and sign in' })
  completeRegistration(
    @Body() body: CompleteRegistrationDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.auth.completeRegistration(body, req, res);
  }

  /**
   * The tight budget on this route is the `sign-in` throttler declared in
   * `app.module.ts`, which counts an address *and* the account in its body —
   * five a minute each, so a class signing in behind one campus address no
   * longer spends the whole minute. It is not a route override because the
   * route also keeps the coarse per-address `default` limit: every attempt
   * against an existing account costs this process a scrypt hash, and an
   * attacker with one address must not be able to ask for unlimited of them.
   */
  @Public()
  @HttpCode(200)
  @Post('sign-in')
  @ApiOperation({ summary: 'Sign in and start a session' })
  signIn(@Body() body: SignInDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.auth.signIn(body, req, res);
  }

  @AllowSuspended()
  @HttpCode(200)
  @Post('sign-out')
  @ApiOperation({ summary: 'End the current session' })
  signOut(@CurrentUser() user: AuthUser, @Res({ passthrough: true }) res: Response) {
    return this.auth.signOut(user, res);
  }

  @Get('me')
  @ApiOperation({ summary: 'Current account, roles and verification state' })
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user);
  }

  /**
   * Sends the registration link again. Same body, answer and effect as
   * `POST /sign-up`, which is the point: neither route will say whether the
   * address has an account.
   */
  // Reuses `ForgotPasswordDto` rather than a DTO of its own: this route needs an
  // address and nothing else, which is exactly what that body is.
  @Public()
  @HttpCode(200)
  @Throttle({ default: MAIL_THROTTLE })
  @Post('resend-verification')
  @ApiOperation({ summary: 'Send a new registration link' })
  resendVerification(@Body() body: ForgotPasswordDto) {
    return this.auth.resendVerification(body);
  }

  @Public()
  @HttpCode(200)
  @Throttle({ default: MAIL_THROTTLE })
  @Post('forgot-password')
  @ApiOperation({ summary: 'Send a password reset link' })
  forgotPassword(@Body() body: ForgotPasswordDto) {
    return this.auth.forgotPassword(body);
  }

  @Public()
  @HttpCode(200)
  @Throttle({ default: TOKEN_THROTTLE })
  @Post('reset-password')
  @ApiOperation({ summary: 'Set a new password using the reset token' })
  resetPassword(@Body() body: ResetPasswordDto) {
    return this.auth.resetPassword(body);
  }

  @HttpCode(200)
  @Post('change-password')
  @ApiOperation({ summary: 'Change the password from inside a session' })
  changePassword(@CurrentUser() user: AuthUser, @Body() body: ChangePasswordDto) {
    return this.auth.changePassword(user, body);
  }
}
