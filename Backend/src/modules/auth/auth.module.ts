import { Logger, Module, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';
import { VerificationService } from './verification.service';
import { MailModule } from '../mail/mail.module';
import { EXPIRED_ROW_SWEEP_MS, JWT_ALGORITHM, JWT_ISSUER } from './auth.constants';

/**
 * The pieces sign-in is made of, wired together in one place.
 *
 * `JwtModule` is configured here rather than in `SessionService` so the secret
 * appears exactly once in the codebase. HS256 is pinned on both halves of the
 * exchange — declaring it only while signing would leave verification accepting
 * any algorithm the library supports — and the issuer is pinned the same way, so
 * a token from another application on the same secret is unverifiable.
 *
 * This module is not `@Global()` and no feature module imports it: the two guards
 * in `../../common/guards/` are registered once in `app.module.ts`, so the session
 * lookup runs in front of every route. What a controller needs from auth is a
 * decorator, not an import.
 */
@Module({
  imports: [
    MailModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET'),
        signOptions: { algorithm: JWT_ALGORITHM, issuer: JWT_ISSUER },
        verifyOptions: { algorithms: [JWT_ALGORITHM], issuer: JWT_ISSUER },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, SessionService, VerificationService],
  // Exported for `AppModule`'s guards: `SessionGuard` resolves the cookie with
  // `SessionService`, and nothing else outside this module reads a token.
  exports: [AuthService, SessionService],
})
export class AuthModule implements OnApplicationBootstrap {
  private readonly logger = new Logger(AuthModule.name);

  constructor(
    private readonly sessions: SessionService,
    private readonly verifications: VerificationService,
  ) {}

  /**
   * The sweep that keeps `sessions` and `verifications` from growing forever.
   *
   * Both tables already refuse expired rows behaviourally (a session past
   * `expiresAt` is `401 INVALID_SESSION`, a spent token is not found), but the
   * rows themselves stay until consumed or revoked — so an unclicked link keeps
   * its address or account id in a table nobody will read again. This is the only
   * path that deletes them.
   *
   * Once at start-up and then once a day: an hour is the shortest lifetime either
   * row can have, the start-up pass catches rows that expired while the server was
   * down, and it is awaited so the rows are gone before the first request.
   * `unref()` makes the timer a janitor rather than a reason to stay alive, so a
   * script that imports this module still exits. A failure is logged and swallowed.
   */
  async onApplicationBootstrap(): Promise<void> {
    await this.removeExpired();
    setInterval(() => void this.removeExpired(), EXPIRED_ROW_SWEEP_MS).unref();
  }

  private async removeExpired(): Promise<void> {
    try {
      const sessions = await this.sessions.deleteExpired();
      const verifications = await this.verifications.deleteExpired();
      if (sessions || verifications) {
        this.logger.log(
          `Removed ${sessions} expired session(s) and ${verifications} expired token(s).`,
        );
      }
    } catch (error) {
      this.logger.warn(
        `Expired-row cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
