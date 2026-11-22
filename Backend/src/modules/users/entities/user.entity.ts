import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  OneToOne,
  PrimaryColumn,
  UpdateDateColumn,
  BeforeInsert,
} from 'typeorm';
import { AccountStatus, Role } from '../../../database/schema';
import { newId } from '../../../database/schema';
import type { Profile } from './profile.entity';
import type { Session } from '../../auth/entities/session.entity';
import type { Listing } from '../../listings/entities/listing.entity';
import type { ListingImage } from '../../listings/entities/listing-image.entity';
import type { Inquiry } from '../../inquiries/entities/inquiry.entity';
import type { Report } from '../../reports/entities/report.entity';
import type { Block } from '../../reports/entities/block.entity';
import type { Notification } from '../../notifications/entities/notification.entity';
import type { ModerationAction } from '../../moderation/entities/moderation-action.entity';

/**
 * A student, a moderator or an administrator — one table for all three.
 *
 * `passwordHash` is `<salt>:<key>` from `src/modules/auth/auth.constants.ts`,
 * never the password. It is nullable so an account created by a future provider
 * can exist without one, and sign-in treats a missing hash as "no password".
 *
 * `emailVerified` is not decorative: registration ends with the student opening
 * a link in their own mailbox, so a row that reaches this column as `false` was
 * written by an administrator by hand. `@VerifiedStudent()` — enforced by
 * `AuthzGuard` — refuses it every route that reaches another student, and
 * `AuthService.signIn` refuses it the session outright.
 *
 * `role` and `status` are separate on purpose: role is what an account may do,
 * status whether it is allowed in at all. A suspended administrator keeps the
 * ADMIN row and still cannot act.
 *
 * `department` and `bio` are public profile fields; `privateContact` is not and
 * nothing sends it — an accepted inquiry shares only the `sharedContact` the
 * owner writes into that request. There is no `institution` field: the platform
 * serves the one institution named in `src/config/env.ts`, so a column for it
 * would hold the same text in every row.
 */
@Entity('users')
@Index(['role', 'status'])
export class User {
  @PrimaryColumn('text')
  id!: string;

  @Column('text')
  name!: string;

  /** The login name, and the only thing a session is identified by. */
  @Column('text', { unique: true })
  email!: string;

  @Column({ type: 'boolean', default: false })
  emailVerified!: boolean;

  @Column('text', { nullable: true })
  passwordHash!: string | null;

  @Column('text', { nullable: true })
  image!: string | null;

  @Column({ type: 'enum', enum: Role, default: Role.USER })
  role!: Role;

  @Column({ type: 'enum', enum: AccountStatus, default: AccountStatus.ACTIVE })
  status!: AccountStatus;

  @Column('text', { nullable: true })
  department!: string | null;

  @Column('text', { nullable: true })
  bio!: string | null;

  @Column('text', { nullable: true })
  privateContact!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  /** Maintained by TypeORM on every `save`/`update`, so it is never a lie. */
  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  // Loaded only when a query asks for them. The relation is the shape of the
  // database; a service decides which of them a given response needs.
  @OneToMany('Session', 'user')
  sessions!: Session[];

  @OneToOne('Profile', 'user')
  profile!: Profile | null;

  @OneToMany('Listing', 'owner')
  listings!: Listing[];

  @OneToMany('ListingImage', 'uploader')
  listingImages!: ListingImage[];

  /** Inquiries this account sent about someone else's listing. */
  @OneToMany('Inquiry', 'inquirer')
  inquiriesSent!: Inquiry[];

  /** Inquiries other students sent about this account's listings. */
  @OneToMany('Inquiry', 'owner')
  inquiriesReceived!: Inquiry[];

  @OneToMany('Report', 'reporter')
  reportsFiled!: Report[];

  @OneToMany('Report', 'targetUser')
  reportsAgainst!: Report[];

  /** Reports this account closed as a moderator, if any. */
  @OneToMany('Report', 'resolvedBy')
  reportsResolved!: Report[];

  @OneToMany('Notification', 'user')
  notifications!: Notification[];

  /** Moderation decisions taken by this account while it was a moderator. */
  @OneToMany('ModerationAction', 'moderator')
  moderationActions!: ModerationAction[];

  @OneToMany('Block', 'blocker')
  blocksCreated!: Block[];

  @OneToMany('Block', 'blocked')
  blockedBy!: Block[];

  /** Ids are made in code because the column has no database default. */
  @BeforeInsert()
  assignId(): void {
    this.id ??= newId();
  }
}
