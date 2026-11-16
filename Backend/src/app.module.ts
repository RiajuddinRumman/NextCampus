import { Module } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { loadEnv } from './config/env';
import { DatabaseModule } from './providers/database/postgres/database.module';
import { MailModule } from './modules/mail/mail.module';
import { AuthModule } from './modules/auth/auth.module';
import { AuthController } from './modules/auth/auth.controller';
import { SIGN_IN_THROTTLE } from './modules/auth/auth.constants';
import { UsersModule } from './modules/users/users.module';
import { ListingsModule } from './modules/listings/listings.module';
import { InquiriesModule } from './modules/inquiries/inquiries.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { ReportsModule } from './modules/reports/reports.module';
import { ModerationModule } from './modules/moderation/moderation.module';
import { AdminModule } from './modules/admin/admin.module';
import { MediaModule } from './modules/media/media.module';
import { AppValidationPipe } from './common/pipes/app-validation.pipe';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { ResponseEnvelopeInterceptor } from './common/interceptors/response-envelope.interceptor';
import { SessionGuard } from './common/guards/session.guard';
import { AuthzGuard } from './common/guards/authz.guard';

function signInBucket(req: Record<string, unknown>): string {
  const ip = typeof req.ip === 'string' ? req.ip : 'unknown-address';
  const body = req.body as { email?: unknown } | undefined;
  const claimed = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  return claimed ? `${ip}|${claimed}` : ip;
}

// Request order: ThrottlerGuard, then SessionGuard, then AuthzGuard, then AppValidationPipe; responses go through the envelope interceptor and the exception filter.
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [() => loadEnv(process.env)] }),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        {
          ttl: config.get<number>('THROTTLE_TTL_MS', 60_000),
          limit: config.get<number>('THROTTLE_LIMIT', 120),
        },
        {
          name: 'sign-in',
          ttl: SIGN_IN_THROTTLE.ttl,
          limit: SIGN_IN_THROTTLE.limit,
          getTracker: signInBucket,
          skipIf: (context: ExecutionContext) =>
            context.getHandler() !== AuthController.prototype.signIn,
        },
      ],
    }),
    DatabaseModule,
    MailModule,
    AuthModule,
    UsersModule,
    MediaModule,
    ListingsModule,
    InquiriesModule,
    NotificationsModule,
    ReportsModule,
    ModerationModule,
    AdminModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_GUARD, useClass: AuthzGuard },
    { provide: APP_PIPE, useClass: AppValidationPipe },
    { provide: APP_INTERCEPTOR, useClass: ResponseEnvelopeInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
