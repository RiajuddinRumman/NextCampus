import { BeforeInsert,Column,CreateDateColumn,Entity,Index,PrimaryColumn,UpdateDateColumn,} from 'typeorm';
import { newId } from '../../../database/schema';

/**
 * A link that went out by e-mail: registration or password reset.
 *
 * `identifier` is `<purpose>:<subject>` — `register:23-54604-3@student.aiub.edu`
 * or `password-reset:c...`. The purpose is what stops a registration link from
 * being replayed as a reset. The subject is a user id for a reset, and an
 * address for a registration, because a registration link is the thing that
 * makes the account: there is no id to name when it is issued.
 *
 * `value` is the SHA-256 of the token, never the token itself. Only the digest
 * is stored because the mailbox is the least private channel in the flow: a
 * leaked table then hands out nothing that works, and a lookup by digest is
 * still possible.
 *
 * One live link per subject and purpose. Asking for a new one replaces the
 * old row, since a digest cannot be read back and mailed again.
 */
@Entity('verifications')
@Index(['identifier'])
@Index(['value'])
export class Verification {
  @PrimaryColumn('text')
  id!: string;

  @Column('text')
  identifier!: string;

  @Column('text')
  value!: string;

  @Column({ type: 'timestamptz' })
  expiresAt!: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  @BeforeInsert()
  assignId(): void {
    this.id ??= newId();
  }
}
