import { Global, Module } from '@nestjs/common';
import { MailCooldown, MailerService } from './mailer.service';

@Global()
@Module({
  providers: [MailerService, MailCooldown],
  exports: [MailerService, MailCooldown],
})
export class MailModule {}
