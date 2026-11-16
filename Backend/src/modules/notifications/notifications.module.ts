import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

/**
 * The bell list: `notify()` writes one row, `list()`/`unread-count`/`read-all`
 * let a student work through it. There is no websocket and no push transport —
 * a client that wants live counts polls `unread-count`, by design, so this
 * module has no state between requests.
 *
 * `NotificationsService` is exported for the one feature that writes bells as
 * part of a bigger flow: `InquiriesService`, which calls `notify()` after
 * creating, accepting or declining an inquiry. The other writers
 * (`users.service.ts` on block, `moderation.service.ts`, `admin.service.ts`)
 * save the `Notification` entity themselves instead of importing this module —
 * and inside `moderation`/`admin` they write it with the transaction's own
 * `EntityManager`, so the bell and the decision row commit together or not at
 * all. That is a two-column insert, not a service call.
 */
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
