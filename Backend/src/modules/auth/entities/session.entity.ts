import { BeforeInsert,Column,CreateDateColumn,Entity,Index,JoinColumn,ManyToOne,PrimaryColumn,UpdateDateColumn,} from 'typeorm';
import { newId } from '../../../database/schema';
import type { User } from '../../users/entities/user.entity';

/**
 * One row per signed-in device.
 *
 * This table is the reason a session can be taken away. The cookie holds a
 * signed token whose `sid` claim is the `token` column here; `SessionGuard`
 * reads the row on every protected request, so deleting it — on sign-out, on suspension,
 * on a password reset — ends that device's access immediately even though the
 * cookie itself is still cryptographically valid.
 *
 * `ipAddress` and `userAgent` answer "which device was this?" in
 * `GET /api/auth/me`. They are never read for a permission decision, and the
 * user agent is truncated on the way in because it arrives from a browser and
 * can be arbitrarily long.
 */
@Entity('sessions')
@Index(['userId'])
export class Session {
  @PrimaryColumn('text')
  id!: string;

  /** Past this instant the row is dead, whatever the cookie says. */
  @Column({ type: 'timestamptz' })
  expiresAt!: Date;

  /** The value the signed cookie carries; unique so it can be looked up directly. */
  @Column('text', { unique: true })
  token!: string;

  @Column('text', { nullable: true })
  ipAddress!: string | null;

  @Column('text', { nullable: true })
  userAgent!: string | null;

  @Column('text')
  userId!: string;

  @ManyToOne('User', 'sessions', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: User;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  @BeforeInsert()
  assignId(): void {
    this.id ??= newId();
  }
}
