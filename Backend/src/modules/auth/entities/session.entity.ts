import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { newId } from '../../../database/schema';
import type { User } from '../../users/entities/user.entity';

@Entity('sessions')
@Index(['userId'])
export class Session {
  @PrimaryColumn('text')
  id!: string;

  @Column({ type: 'timestamptz' })
  expiresAt!: Date;

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
