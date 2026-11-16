import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { MediaModule } from '../media/media.module';

/**
 * The account the caller owns: profile read/write and the block list.
 *
 * `UsersService` is exported because two other features need a piece of it and
 * should not re-implement the rule:
 *
 * - `ListingsService` calls `areBlocked()` before showing a listing detail.
 * - `InquiriesService` calls it again before creating or answering an inquiry.
 *
 * Those are the same question asked in two places, so it is written once — a
 * second copy would be the bug report where one route respects a block and
 * another does not.
 *
 * There is one import, `MediaModule`, and it is there because `PATCH /api/users/me`
 * stores a picture _URL_: the module that hands those URLs out is the one that
 * can say which of them this platform actually uploaded. Nothing else is
 * imported, not even for auth: the two global guards decide who may reach
 * `UsersController`, and the controller says what it needs with a marker on the
 * route. Blocking notifies the other person and the public profile
 * counts their live listings, but both are plain repository reads/writes on
 * entities the global `DatabaseModule` already provides, which avoids a
 * `UsersModule ↔ NotificationsModule` cycle for a single row.
 */
@Module({
  imports: [MediaModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
