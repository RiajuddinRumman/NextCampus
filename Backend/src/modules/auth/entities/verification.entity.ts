import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { newId } from '../../../database/schema';

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
