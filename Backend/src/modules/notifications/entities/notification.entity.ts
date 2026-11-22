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
import { NotificationType } from '../../../database/schema';
import { newId } from '../../../database/schema';
import type { User } from '../../users/entities/user.entity';

/**
 * The inbox: everything the platform decided to tell an account.
 *
 * A notification never copies the event it describes. `title` and `body` are
 * what the student reads in the list, and `link` is the id of the thing
 * behind it — the inquiry, the listing, the report — so the app can open the
 * real, current version instead of a frozen snapshot that may already be
 * wrong. That is also why there is no payload column: two copies of the truth
 * is one too many.
 *
 * `readAt` is a timestamp rather than a boolean so "unread" can be counted
 * (the badge) and "when did they see it" can be answered (the moderation
 * queue depends on people actually being told).
 *
 * Rows are written by whichever service caused the event, in the same
 * transaction as the event itself, so a notification cannot describe a change
 * that did not happen — or survive one that was rolled back.
 */
@Entity('notifications')
@Index(['userId', 'readAt', 'createdAt'])
export class Notification {
  @PrimaryColumn('text')
  id!: string;

  @Column('text')
  userId!: string;

  @Column({ type: 'enum', enum: NotificationType })
  type!: NotificationType;

  @Column('text')
  title!: string;

  @Column('text', { nullable: true })
  body!: string | null;

  /** Id of the entity this is about, or a route the app should open. */
  @Column('text', { nullable: true })
  link!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  readAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @ManyToOne('User', 'notifications', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: User;

  @BeforeInsert()
  assignId(): void {
    this.id ??= newId();
  }
}
