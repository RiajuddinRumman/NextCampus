import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ReportStatus, ReportTargetType } from '../../../database/schema';
import { newId } from '../../../database/schema';
import type { Listing } from '../../listings/entities/listing.entity';
import type { ModerationAction } from '../../moderation/entities/moderation-action.entity';
import type { User } from '../../users/entities/user.entity';

/**
 * A student telling a moderator that something is wrong.
 *
 * A report points at exactly one of `targetUserId` (a person) or
 * `targetListingId` (a post). Both are nullable instead of one tagged column
 * because PostgreSQL cannot express "one of these two" in a foreign key;
 * `ReportsService` keeps the pair in step with `targetType`, so a LISTING
 * report never carries a user id.
 *
 * `reporterId` is kept so a moderator knows who to ask for detail, and it is
 * half of the rule that one student cannot hold two open reports about the same
 * target — read by `ReportsService.file()`, and made worth trusting under
 * concurrent requests by the two partial unique indexes below. Those cover only
 * `OPEN` and `UNDER_REVIEW`, which is why filing again after a report closes is
 * allowed.
 *
 * The status is the workflow: OPEN, then UNDER_REVIEW once a moderator picks it
 * up, then RESOLVED or DISMISSED. `resolvedById` and `resolutionNote` are only
 * ever written together with a final status, which is what keeps the queue
 * auditable after the fact.
 */
@Entity('reports')
@Index(['status', 'createdAt'])
@Index('reports_open_listing_key', ['reporterId', 'targetListingId'], {
  unique: true,
  where: `"status" IN ('OPEN', 'UNDER_REVIEW') AND "targetListingId" IS NOT NULL`,
})
@Index('reports_open_user_key', ['reporterId', 'targetUserId'], {
  unique: true,
  where: `"status" IN ('OPEN', 'UNDER_REVIEW') AND "targetUserId" IS NOT NULL`,
})
export class Report {
  @PrimaryColumn('text')
  id!: string;

  @Column('text')
  reporterId!: string;

  @Column({ type: 'enum', enum: ReportTargetType })
  targetType!: ReportTargetType;

  @Column('text', { nullable: true })
  targetUserId!: string | null;

  @Column('text', { nullable: true })
  targetListingId!: string | null;

  @Column('text')
  reason!: string;

  /** Free-text grouping ('SPAM', 'SCAM', 'OTHER'…); not an enum on purpose. */
  @Column('text', { default: 'OTHER' })
  category!: string;

  @Column({ type: 'enum', enum: ReportStatus, default: ReportStatus.OPEN })
  status!: ReportStatus;

  @Column('text', { nullable: true })
  resolutionNote!: string | null;

  @Column('text', { nullable: true })
  resolvedById!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  @ManyToOne('User', 'reportsFiled', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'reporterId' })
  reporter!: User;

  @ManyToOne('User', 'reportsAgainst', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'targetUserId' })
  targetUser!: User | null;

  @ManyToOne('Listing', 'reports', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'targetListingId' })
  targetListing!: Listing | null;

  /** A moderator leaving the platform must not delete the record of their decision. */
  @ManyToOne('User', 'reportsResolved', { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'resolvedById' })
  resolvedBy!: User | null;

  @OneToMany('ModerationAction', 'report')
  moderationActions!: ModerationAction[];

  @BeforeInsert()
  assignId(): void {
    this.id ??= newId();
  }
}

/**
 * The two clusters of `ReportStatus` a decision is defined against, beside the
 * column they filter. `OPEN_STATUSES` is the queue's default filter and the
 * window the duplicate check in `file()` looks through — it must name the same
 * statuses as the index predicates above and in the migration.
 *
 * `CLOSE_OUTCOMES` is both what a moderator may close with and the test for
 * "already closed", so one array serves both: a third outcome added to one
 * list and not the other would let a report be closed twice.
 */
export const OPEN_STATUSES = [ReportStatus.OPEN, ReportStatus.UNDER_REVIEW];

export const CLOSE_OUTCOMES = [ReportStatus.RESOLVED, ReportStatus.DISMISSED] as const;
export type CloseOutcome = (typeof CLOSE_OUTCOMES)[number];
