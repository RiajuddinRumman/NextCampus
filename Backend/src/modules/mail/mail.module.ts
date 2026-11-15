import { Global, Module } from '@nestjs/common';
import { MailCooldown, MailerService } from './mailer.service';

/**
 * `@Global()` so that `AuthModule` can inject `MailerService` without
 * importing this file — the same reason `DatabaseModule` is global. Verification
 * and password-reset links are the only mail this project sends, and both are
 * written by the auth service, so there is exactly one consumer either way.
 *
 * Keeping it global is a deliberate trade-off: it saves an import line today
 * and makes the dependency invisible in `auth.module.ts`, so when you add a
 * second feature that sends mail (a report receipt, say) you will find the
 * provider here rather than by following an import.
 *
 * There is no SMTP requirement: with no `SMTP_HOST` the service prints the
 * link to the log instead of sending it, which is what the e2e suite reads.
 */
@Global()
@Module({
  providers: [MailerService, MailCooldown],
  exports: [MailerService, MailCooldown],
})
export class MailModule {}
