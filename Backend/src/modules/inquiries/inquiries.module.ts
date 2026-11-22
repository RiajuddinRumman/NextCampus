import { Module } from '@nestjs/common';
import { InquiriesController } from './inquiries.controller';
import { InquiriesService } from './inquiries.service';
import { UsersModule } from '../users/users.module';
import { NotificationsModule } from '../notifications/notifications.module';

/**
 * The one module that needs two others, because an inquiry is a conversation
 * between accounts:
 *
 * - `UsersModule` — to check the block list before letting anyone write. Nothing
 *   here reads a contact: an accepted inquiry shares only the `sharedContact` the
 *   owner sent in that same request, which `contactToShare` enforces.
 * - `NotificationsModule` — so both sides get a bell entry when an inquiry is
 *   received, accepted or declined.
 *
 * `ListingsModule` is deliberately *not* imported: the inquiry service reads
 * the listing through its own repository (available globally) rather than
 * calling into listing logic, which keeps a student posting an inquiry from
 * being able to trigger a listing mutation by accident.
 */
@Module({
  imports: [UsersModule, NotificationsModule],
  controllers: [InquiriesController],
  providers: [InquiriesService],
  exports: [InquiriesService],
})
export class InquiriesModule {}
