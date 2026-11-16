import { Logger, Module, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';
import { VerificationService } from './verification.service';
import { MailModule } from '../mail/mail.module';
import { EXPIRED_ROW_SWEEP_MS, JWT_ALGORITHM, JWT_ISSUER } from './auth.constants';

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
  exports: [AuthService, SessionService],
})
export class AuthModule implements OnApplicationBootstrap {
  private readonly logger = new Logger(AuthModule.name);

  constructor(
    private readonly sessions: SessionService,
    private readonly verifications: VerificationService,
  ) {}

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
