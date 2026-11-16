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

/**
 * Whose sign-in budget a request spends: this address, asking about this account.
 *
 * The address is `req.ip`, which belongs to the student only if `TRUST_PROXY_HOPS`
 * says how many proxies stand in front of this process (see `main.ts`). Behind a
 * host that forwards and a deployment that left the setting at `0`, the whole
 * campus is one bucket to every limit here — including this one.
 *
 * A body that names no account — the malformed requests, which the guard sees
 * before the validation pipe does — falls back to the address alone, so junk costs
 * its sender exactly the budget it always did. The address is not IPv6-collapsed
 * the way the guard collapses it for the baseline context; the coarse per-address
 * limit below is what a caller holding a block of addresses still has to fit in.
 */
function signInBucket(req: Record<string, unknown>): string {
  const ip = typeof req.ip === 'string' ? req.ip : 'unknown-address';
  const body = req.body as { email?: unknown } | undefined;
  const claimed = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  return claimed ? `${ip}|${claimed}` : ip;
}

/**
 * The application's wiring, and the only place the cross-cutting rules are
 * declared. A request passes through these in order:
 *
 *   1. body parser         — turns the bytes into an object
 *   2. ThrottlerGuard      — has this caller asked too often?
 *   3. SessionGuard        — who is calling? (attaches the account, or refuses)
 *   4. AuthzGuard          — may they do this? (role, status, verified domain)
 *   5. AppValidationPipe   — does the payload match the DTO for this route?
 *   6. controller          — business rules only
 *   7. ResponseEnvelope    — every success becomes `{ data, meta }`
 *   8. AllExceptionsFilter — every failure becomes `{ statusCode, code, … }`
 *
 * Guards run before the pipe, so an anonymous *and* malformed request is
 * refused for being anonymous (401) rather than for its payload (400).
 *
 * Each route states what it needs (`@Public()`, `@VerifiedStudent()`,
 * `@Roles(...)`, `@AllowSuspended()`), and only `@Public()` decides whether a
 * session is needed at all — everything else is protected by default, so the
 * mistake a newcomer can make is locking a route that should be open, which the
 * e2e suite catches with a 401, rather than leaving a student-only route open.
 *
 * Modules are listed in dependency order (data access, then mail, then the
 * features using them). `DatabaseModule` and `MailModule` are `@Global()`, so
 * feature modules never import them; `AuthModule` is not, because the two
 * guards above protect a route without any auth import.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [() => loadEnv(process.env)] }),
    ThrottlerModule.forRootAsync({
      // One baseline for every route, read through `ConfigService` rather than
      // off `process.env` so a malformed `THROTTLE_LIMIT` stops the process at
      // start-up instead of becoming `NaN` and switching rate limiting off in
      // silence. `DatabaseModule` below is the same pattern.
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        {
          ttl: config.get<number>('THROTTLE_TTL_MS', 60_000),
          limit: config.get<number>('THROTTLE_LIMIT', 120),
        },
        // A second, tighter budget for one route: five sign-in attempts a minute
        // for an address *and* the account its body names. Per address alone —
        // what the baseline above counts — is the wrong unit for a login, because
        // a campus puts a class of students behind one public address and the
        // fifth mistyped password refuses the sixth person. Per account alone is
        // wrong the other way: one caller would get five tries against every
        // account on the platform each minute, and a try against an account that
        // exists costs this process a scrypt hash.
        //
        // Declared here rather than as `@Throttle` on the route because a route
        // override replaces the `default` context for that route — which would
        // drop the coarse per-address bound the comment above is about — and
        // `skipIf` keeps this one off every route that has no password to try.
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
    // Guards run in registration order. Rate limiting is per IP and needs to
    // know nothing about the caller, so it comes first and an anonymous flood
    // never reaches the session lookup; identity is settled next, and only then
    // the permission decision.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_GUARD, useClass: AuthzGuard },
    // Every DTO in every controller is validated by this one pipe; handlers
    // only declare the DTO type.
    { provide: APP_PIPE, useClass: AppValidationPipe },
    { provide: APP_INTERCEPTOR, useClass: ResponseEnvelopeInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
