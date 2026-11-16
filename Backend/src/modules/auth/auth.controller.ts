import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { AllowSuspended, Public } from '../../common/decorators/auth.decorators';
import type { AuthUser } from './session.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { MAIL_THROTTLE, TOKEN_THROTTLE } from './auth.constants';
import {
  ChangePasswordDto,
  CompleteRegistrationDto,
  ForgotPasswordDto,
  ResetPasswordDto,
  SignInDto,
  SignUpDto,
} from './dto/auth.dto';

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
