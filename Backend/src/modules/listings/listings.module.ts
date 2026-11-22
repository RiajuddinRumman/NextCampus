import { Module } from '@nestjs/common';
import { ListingsController } from './listings.controller';
import { ListingCardService } from './listing-card.service';
import { ListingsService } from './listings.service';
import { UsersModule } from '../users/users.module';
import { MediaModule } from '../media/media.module';

/**
 * The five listing categories, all behind one controller: `ListingsService` for
 * the routes, `ListingCardService` for what a listing looks like in a response,
 * and `listing-filters.ts` — not a provider, it holds nothing — for how a
 * search becomes SQL.
 *
 * Only `ListingsService` is exported, for the moderation module's hidden queue
 * (`listHidden()`) and the pending-inquiry settle a suspension runs (`settlePendingInquiries()`).
 * The hide/unhide *writes* stay in `ModerationService`, which updates the row
 * and its audit entry in one transaction so a staff decision never runs through
 * the student-facing status rules. `UsersModule` is
 * here for the block check in `detail()`; `MediaModule` for `ImageUrlPolicy`,
 * the rule that connects the upload and listing routes over one folder.
 */
@Module({
  imports: [UsersModule, MediaModule],
  controllers: [ListingsController],
  providers: [ListingsService, ListingCardService],
  exports: [ListingsService],
})
export class ListingsModule {}
