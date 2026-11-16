import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { ModerationActionType, ReportTargetType } from '../../../database/schema';
import { newId } from '../../../database/schema';
import type { Report } from '../../reports/entities/report.entity';
import type { User } from '../../users/entities/user.entity';

/**
 * What a moderator did, append-only — the table that answers a complaint three
 * months later: not what the listing looks like now, but who hid it, when, and
 * the reason they typed. Hence no update path anywhere in the codebase; a
 * corrected decision is a second row and both stay.
 *
 * `reason` is required by the DTO on every action, so a row is never just
 * "listing hidden". `targetType` with `targetUserId`/`targetListingId` follows
 * the same one-of-two shape as `Report`, and `reportId` ties the decision back
 * to the complaint that caused it when there was one.
 *
 * Read the FK directions before deleting an account:
 *
 * - `moderatorId` is `ON DELETE CASCADE`, so hard-deleting a moderator or admin
 *   erases every decision recorded under their name — which is why
 *   `AdminService.removeUser()` refuses any account that still owns listings,
 *   inquiries, reports or audit rows (`ACCOUNT_HAS_HISTORY`) and why suspend is
 *   the normal answer for a staff account.
 * - `targetUserId` is plain `text` with no FK, so a decision *about* someone
 *   outlives that person by design.
 * - `reportId` is `SET NULL`: a deleted report costs the decision its link,
 *   never the row.
 */
@Entity('moderation_actions')
@Index(['createdAt'])
export class ModerationAction {
  @PrimaryColumn('text')
  id!: string;

  @Column('text')
  moderatorId!: string;

  @Column({ type: 'enum', enum: ModerationActionType })
  action!: ModerationActionType;

  @Column('text')
  reason!: string;

  @Column({ type: 'enum', enum: ReportTargetType, nullable: true })
  targetType!: ReportTargetType | null;

  @Column('text', { nullable: true })
  targetUserId!: string | null;

  @Column('text', { nullable: true })
  targetListingId!: string | null;

  /** The complaint that caused this, when there was one. */
  @Column('text', { nullable: true })
  reportId!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @ManyToOne('User', 'moderationActions', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'moderatorId' })
  moderator!: User;

  /** A closed report keeps the decision even if the report row goes away. */
  @ManyToOne('Report', 'moderationActions', { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'reportId' })
  report!: Report | null;

  @BeforeInsert()
  assignId(): void {
    this.id ??= newId();
  }
}
