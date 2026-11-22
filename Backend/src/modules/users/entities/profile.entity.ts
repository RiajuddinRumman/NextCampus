import { BeforeInsert, Column, Entity, JoinColumn, OneToOne, PrimaryColumn } from 'typeorm';
import { newId } from '../../../database/schema';
import type { User } from './user.entity';

/**
 * The free-text part of a student's public page, one row per account.
 *
 * It is a separate table rather than four more columns on `users` because it
 * is edited on its own, read on its own, and is absent for most accounts —
 * `UsersService` returns `profile: null` and the front end shows the edit
 * form instead of an empty box.
 *
 * `userId` is unique, which is what makes this one-to-one: a second row for
 * the same student is rejected by the database, not by a check in code that a
 * future contributor could forget.
 */
@Entity('profiles')
export class Profile {
  @PrimaryColumn('text')
  id!: string;

  @Column('text', { unique: true })
  userId!: string;

  /** One line under the name, e.g. "CSE 4th year, looking for study groups". */
  @Column('text', { nullable: true })
  headline!: string | null;

  @Column('text', { nullable: true })
  about!: string | null;

  /** Comma-separated interests, kept as plain text because nothing filters on it. */
  @Column('text', { nullable: true })
  interests!: string | null;

  @OneToOne('User', 'profile', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: User;

  @BeforeInsert()
  assignId(): void {
    this.id ??= newId();
  }
}
