import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { Request, Response } from 'express';
import { User } from '../../database/entities/index';
import { AccountStatus, Role } from '../../database/schema';
import { MailCooldown, MailerService, mailLinkBase, mailedLink } from '../mail/mailer.service';
import { Errors } from '../../common/errors';
import { isDuplicateKey } from '../../common/helpers/is-duplicate-key';
import { INSTITUTION_EMAIL_SUFFIX, isInstitutionEmail } from '../../config/env';
import { SessionService, type AuthUser } from './session.service';
import { VerificationService } from './verification.service';
import {
  PASSWORD_RESET_TTL_SECONDS,
  REGISTRATION_TTL_SECONDS,
  hashPassword,
  verifyPassword,
} from './auth.constants';
import type {
  ChangePasswordDto,
  CompleteRegistrationDto,
  ForgotPasswordDto,
  ResetPasswordDto,
  SignInDto,
  SignUpDto,
} from './dto/auth.dto';

export type PublicUser = Pick<
  User,
  | 'id'
  | 'name'
  | 'email'
  | 'emailVerified'
  | 'image'
  | 'role'
  | 'status'
  | 'department'
  | 'bio'
  | 'createdAt'
>;

function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    emailVerified: user.emailVerified,
    image: user.image,
    role: user.role,
    status: user.status,
    department: user.department,
    bio: user.bio,
    createdAt: user.createdAt,
  };
}

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly sessions: SessionService,
    private readonly verifications: VerificationService,
    private readonly mailer: MailerService,
    private readonly mailCooldown: MailCooldown,
    private readonly config: ConfigService,
  ) {}

  async signUp(dto: SignUpDto) {
    return this.mailRegistrationLink(this.studentAddress(dto.email));
  }

  async completeRegistration(dto: CompleteRegistrationDto, req: Request, res: Response) {
    const email = await this.verifications.consume('register', dto.token);
    if (!email) throw Errors.invalidTokenLink('registration');

    if (await this.users.findOne({ where: { email }, select: { id: true } })) {
      throw Errors.accountExists();
    }

    let account: User;
    try {
      account = await this.users.save(
        this.users.create({
          name: dto.name.trim(),
          email,
          passwordHash: await hashPassword(dto.password),
          emailVerified: true,
          role: Role.USER,
          status: AccountStatus.ACTIVE,
          department: dto.department?.trim() ?? null,
        }),
      );
    } catch (error) {
      if (isDuplicateKey(error)) throw Errors.accountExists();
      throw error;
    }

    const user = toPublicUser(account);
    return {
      user,
      session: await this.startSession(user.id, req, res),
      message: 'Welcome. Your account is ready.',
    };
  }

  // Credentials, then verification, then suspension; a session row is opened only after all three pass.
  async signIn(dto: SignInDto, req: Request, res: Response) {
    const account = await this.users.findOne({ where: { email: dto.email } });
    const credentialsMatch = await verifyPassword(
      dto.password,
      account?.passwordHash ?? (await this.placeholderHash()),
    );
    if (!account || !credentialsMatch) {
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Incorrect e-mail or password',
      });
    }
    if (!account.emailVerified) {
      throw new ForbiddenException({
        code: 'EMAIL_NOT_VERIFIED',
        message: 'Verify your institutional e-mail before signing in',
      });
    }
    if (account.status === AccountStatus.SUSPENDED) {
      throw new ForbiddenException({
        code: 'ACCOUNT_SUSPENDED',
        message: 'Account is suspended, contact an administrator',
      });
    }

    const user = toPublicUser(account);
    return { user, session: await this.startSession(user.id, req, res) };
  }

  async signOut(user: AuthUser, res: Response) {
    await this.sessions.revoke(user.sessionId);
    this.sessions.clearCookie(res);
    return { message: 'Signed out' };
  }

  async me(user: AuthUser) {
    const account = await this.users.findOne({ where: { id: user.id } });
    if (!account) {
      throw new UnauthorizedException({ code: 'USER_NOT_FOUND', message: 'Unknown user' });
    }
    return { user: toPublicUser(account), session: await this.sessions.describe(user.sessionId) };
  }

  async resendVerification(dto: ForgotPasswordDto) {
    return this.mailRegistrationLink(this.studentAddress(dto.email));
  }

  async forgotPassword(dto: ForgotPasswordDto) {
    const account = await this.users.findOne({
      where: { email: dto.email },
      select: { id: true, email: true },
    });
    if (account) {
      const cooldownKey = `password-reset:${account.email}`;
      if (this.mailCooldown.take(cooldownKey)) {
        const { token, email } = await this.verifications.issue(
          'password-reset',
          { key: account.id, email: account.email },
          PASSWORD_RESET_TTL_SECONDS,
        );
        const delivered = await this.mailer.send({
          to: email,
          subject: 'Reset your password',
          text: `Open this link within one hour to choose a new password:\n\n${this.link('reset-password', token)}`,
        });
        if (!delivered) this.mailCooldown.refund(cooldownKey);
      }
    }
    return { message: 'If the address exists, a reset link has been sent.' };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const userId = await this.verifications.consume('password-reset', dto.token);
    if (!userId) throw Errors.invalidTokenLink('reset');

    const account = await this.users.findOne({ where: { id: userId }, select: { id: true } });
    if (!account) throw Errors.unknownAccount();

    await this.users.update({ id: account.id }, { passwordHash: await hashPassword(dto.password) });
    await this.sessions.revokeAllForUser(account.id);
    return { message: 'Password updated' };
  }

  async changePassword(user: AuthUser, dto: ChangePasswordDto) {
    const stored = await this.users.findOne({
      where: { id: user.id },
      select: { passwordHash: true },
    });
    if (!(await verifyPassword(dto.currentPassword, stored?.passwordHash ?? null))) {
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Current password is incorrect',
      });
    }

    await this.users.update({ id: user.id }, { passwordHash: await hashPassword(dto.newPassword) });
    await this.sessions.revokeAllForUser(user.id, user.sessionId);
    return { message: 'Password updated' };
  }

  private async startSession(userId: string, req: Request, res: Response) {
    const session = await this.sessions.issue(userId, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    const token = await this.sessions.sign({ sub: userId, sid: session.token });
    this.sessions.writeCookie(res, token);
    return session;
  }

  private studentAddress(email: string): string {
    const address = email.trim().toLowerCase();
    if (!isInstitutionEmail(address)) {
      throw new ForbiddenException({
        code: 'UNAPPROVED_EMAIL_DOMAIN',
        message: `Only ${INSTITUTION_EMAIL_SUFFIX} addresses may register`,
      });
    }
    return address;
  }

  private async mailRegistrationLink(email: string) {
    const cooldownKey = `register:${email}`;
    if (
      !(await this.users.findOne({ where: { email }, select: { id: true } })) &&
      this.mailCooldown.take(cooldownKey)
    ) {
      const { token } = await this.verifications.issue(
        'register',
        { key: email, email },
        REGISTRATION_TTL_SECONDS,
      );
      const delivered = await this.mailer.send({
        to: email,
        subject: 'Finish creating your student account',
        text:
          'Someone asked to open a student account for this address.\n\n' +
          `If it was you, open this link within 24 hours to choose a password:\n\n` +
          `${this.link('complete-registration', token)}\n\n` +
          'If it was not you, ignore this message: no account has been created.',
      });
      if (!delivered) this.mailCooldown.refund(cooldownKey);
    }
    return { message: 'If the address is a student mailbox, a link is on its way.' };
  }

  private link(route: string, token: string): string {
    return mailedLink(
      route,
      token,
      mailLinkBase({
        FRONTEND_URL: this.config.get<string>('FRONTEND_URL'),
        APP_BASE_URL: this.config.get<string>('APP_BASE_URL') ?? '',
        API_PREFIX: this.config.get<string>('API_PREFIX', 'api'),
      }),
    );
  }

  private placeholder?: string;
  private async placeholderHash(): Promise<string> {
    this.placeholder ??= await hashPassword(`no-such-account-${Date.now()}`);
    return this.placeholder;
  }
}
