import { Module } from '@nestjs/common';
import { ModerationController } from './moderation.controller';
import { ModerationService } from './moderation.service';
import { ListingsModule } from '../listings/listings.module';

/**
 * The staff actions half of the platform: hide/unhide a listing, warn,
 * suspend, restore, plus the two read routes that show their results
 * (`hidden-listings` and the `actions` audit trail). The report *queue* is a
 * different file — `reports.controller.ts` owns it, because a report is a
 * student-created object that staff work on, while everything here is
 * staff-created from the first keystroke.
 *
 * Every write here ends in a `ModerationAction` row, so this is the module
 * that makes a decision *provable* after the fact.
 *
 * `ListingsModule` is imported for the two listing reads and writes a staff
 * action needs and `ListingsService` already owns: `listHidden()` for the
 * hidden-listings list, and the pending-inquiry settle that
 * `suspendUser()` runs inside its own transaction. The direction is one-way —
 * nothing in `ListingsModule` imports this one.
 *
 * It is *not* imported by `AdminModule`, even though admins do moderation too:
 * the admin service talks to the repositories directly, and keeping the two
 * services separate is what leaves one obvious place to look when a rule about
 * who may do what needs changing (`moderation.service.ts` for staff actions,
 * `admin.service.ts` for account-level ones).
 */
@Module({
  imports: [ListingsModule],
  controllers: [ModerationController],
  providers: [ModerationService],
  exports: [ModerationService],
})
export class ModerationModule {}
