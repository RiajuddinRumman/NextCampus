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
import { PASSWORD_RESET_TTL_SECONDS,REGISTRATION_TTL_SECONDS,hashPassword,verifyPassword,} from './auth.constants';
import type { ChangePasswordDto,CompleteRegistrationDto,ForgotPasswordDto,ResetPasswordDto,SignInDto,SignUpDto,} from './dto/auth.dto';

/**
 * The account shape an auth response is allowed to contain. `passwordHash` is
 * left out by naming the fields: it is a column, not part of the API.
 */
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

/**
 * Registration is two calls and the split is the point: `signUp` writes nothing
 * and only mails a link, and `completeRegistration` makes the account for whoever
 * can open that mailbox — so a student address cannot be claimed in advance with
 * a password a stranger chose.
 *
 * No response here contains a credential. The session travels only as an httpOnly
 * cookie, which is why the browser stays signed in while page scripts cannot read
 * what they were handed.
 */
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

  /**
   * First half of registration: asks whether the mailbox can receive mail and
   * writes nothing. The answer is identical whether or not an account exists, so
   * a route cannot be used to find out which roll numbers signed up.
   */
  async signUp(dto: SignUpDto) {
    return this.mailRegistrationLink(this.studentAddress(dto.email));
  }

  /**
   * Second half: the link in the mailbox plus the name and password that could
   * not be trusted from a stranger. The address comes out of the token and nowhere
   * else, so this cannot be pointed at a mailbox the caller did not just open; the
   * account is written verified — that proof is what the link was.
   */
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
      // The read above is not a lock, so the loser of that race learns about it
      // from the unique index on `email` and gets the same refusal as the friendly
      // check, not a 500.
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

  /**
   * Starts a session for proven credentials. A wrong password and an unknown
   * address answer identically, and every state check runs before a session
   * exists — so an account not allowed in never receives a cookie.
   */
  async signIn(dto: SignInDto, req: Request, res: Response) {
    // The full row is read only because the hash is needed here.
    const account = await this.users.findOne({ where: { email: dto.email } });
    // An unknown address is checked against a hash of a password nobody sent, so
    // how long the answer takes does not reveal whether the account exists.
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

  /** Ends the session that made the call; other devices keep their cookies. */
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

  /**
   * "I never got the link." The same call and same neutral answer as `signUp`:
   * this route cannot say whether a link is outstanding for somebody else's
   * address.
   */
  async resendVerification(dto: ForgotPasswordDto) {
    return this.mailRegistrationLink(this.studentAddress(dto.email));
  }

  /**
   * Mails a reset link when the address is registered, and says the same thing
   * either way: a forgotten-password form must not publish who has an account.
   */
  async forgotPassword(dto: ForgotPasswordDto) {
    const account = await this.users.findOne({
      where: { email: dto.email },
      select: { id: true, email: true },
    });
    // Its own cooldown key: an hour of forgot-password clicks from one address
    // sends one message, not forty.
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
        // A minute spent on a mail that never left this process is not the
        // student's to pay for, so the slot goes back.
        if (!delivered) this.mailCooldown.refund(cooldownKey);
      }
    }
    return { message: 'If the address exists, a reset link has been sent.' };
  }

  /**
   * Sets a new password from a reset link and logs every other device out,
   * because whoever read the mailbox may already know the old password.
   */
  async resetPassword(dto: ResetPasswordDto) {
    const userId = await this.verifications.consume('password-reset', dto.token);
    if (!userId) throw Errors.invalidTokenLink('reset');

    // The account can have been deleted since the link was mailed.
    const account = await this.users.findOne({ where: { id: userId }, select: { id: true } });
    if (!account) throw Errors.unknownAccount();

    await this.users.update({ id: account.id }, { passwordHash: await hashPassword(dto.password) });
    await this.sessions.revokeAllForUser(account.id);
    return { message: 'Password updated' };
  }

  /**
   * Changes the password from inside a session. The session making the call is
   * kept, so the student is not logged out of the tab they just used.
   */
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

  /** Writes the `sessions` row first, then the cookie that points at it. */
  private async startSession(userId: string, req: Request, res: Response) {
    const session = await this.sessions.issue(userId, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    const token = await this.sessions.sign({ sub: userId, sid: session.token });
    this.sessions.writeCookie(res, token);
    return session;
  }

  /**
   * The address rule: refused if not a student mailbox, otherwise normalised,
   * because the lower-cased text is both what the link is keyed by and what the
   * account is created with.
   */
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

  /**
   * Mails a registration link and answers the same sentence either way. An
   * address with an existing account is not sent a "finish your registration"
   * link — they need the password reset — but the caller is not told which of the
   * two happened.
   */
  private async mailRegistrationLink(email: string) {
    // Two reasons to stay quiet, and the caller hears neither: the address
    // already has an account, or a link went there less than a minute ago. In the
    // second case the link already in the mailbox is left alive rather than
    // replaced, so refusing to send another never strands the student with a dead
    // one.
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
      // Same reason as in `forgotPassword()`: a failed delivery reached nobody and
      // must not lock this mailbox for the next minute.
      if (!delivered) this.mailCooldown.refund(cooldownKey);
    }
    return { message: 'If the address is a student mailbox, a link is on its way.' };
  }

  /**
   * Mailed links point at the front end, which reads the `token` parameter and
   * posts it back. `mailLinkBase` is where a link goes when no front end is set.
   */
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

  /** Cached hash used only to keep unknown-address sign-ins equally slow. */
  private placeholder?: string;
  private async placeholderHash(): Promise<string> {
    this.placeholder ??= await hashPassword(`no-such-account-${Date.now()}`);
    return this.placeholder;
  }
}
