import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  Unique,
} from 'typeorm';
import { newId } from '../../../database/schema';
import type { User } from '../../users/entities/user.entity';

/**
 * "Do not show me this person, and do not show them me."
 *
 * One row per ordered pair: A blocking B says nothing about B blocking A, so
 * `@@Unique(blockerId, blockedId)` stops a double insert in one direction and
 * still allows the other. Both directions are checked before an inquiry or a
 * message is created — the pair is tested in whichever order it appears, and
 * the reason a student cannot reach someone they did not block is that the
 * other half of the pair blocked them first.
 *
 * There is no note, no reason, no expiry. A block is a fact between two
 * accounts, and deleting either account removes it.
 */
@Entity('blocks')
@Unique(['blockerId', 'blockedId'])
@Index(['blockedId'])
export class Block {
  @PrimaryColumn('text')
  id!: string;

  @Column('text')
  blockerId!: string;

  @Column('text')
  blockedId!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @ManyToOne('User', 'blocksCreated', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'blockerId' })
  blocker!: User;

  @ManyToOne('User', 'blockedBy', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'blockedId' })
  blocked!: User;

  @BeforeInsert()
  assignId(): void {
    this.id ??= newId();
  }
}
