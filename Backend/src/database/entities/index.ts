/**
 * Every mapped class in one list, shared by three consumers: the Nest
 * connection, the standalone DataSource the migration CLI uses, and the e2e
 * harness. If they ever disagreed about which entities exist, a developer could
 * migrate a schema the running application cannot read — so there is exactly
 * one place to look.
 */
import { Block } from '../../modules/reports/entities/block.entity';
import { Inquiry } from '../../modules/inquiries/entities/inquiry.entity';
import { Listing } from '../../modules/listings/entities/listing.entity';
import { ListingImage } from '../../modules/listings/entities/listing-image.entity';
import { ModerationAction } from '../../modules/moderation/entities/moderation-action.entity';
import { Notification } from '../../modules/notifications/entities/notification.entity';
import { Profile } from '../../modules/users/entities/profile.entity';
import { Report } from '../../modules/reports/entities/report.entity';
import { Session } from '../../modules/auth/entities/session.entity';
import { User } from '../../modules/users/entities/user.entity';
import { Verification } from '../../modules/auth/entities/verification.entity';

export const entities = [
  Block,
  Inquiry,
  Listing,
  ListingImage,
  ModerationAction,
  Notification,
  Profile,
  Report,
  Session,
  User,
  Verification,
];

export {
  Block,
  Inquiry,
  Listing,
  ListingImage,
  ModerationAction,
  Notification,
  Profile,
  Report,
  Session,
  User,
  Verification,
};
