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
import { InquiryStatus } from '../../../database/schema';
import { newId } from '../../../database/schema';
import type { Listing } from '../../listings/entities/listing.entity';
import type { User } from '../../users/entities/user.entity';

/**
 * The first message about a listing, and the thread that grows from it.
 *
 * An inquiry names three parties: the listing, the student who asked, and the
 * student who owns it. The owner is copied onto the row instead of being read
 * through `listing` so that "my inquiries" is one indexed lookup on `ownerId`
 * rather than a join through every listing the person ever posted.
 *
 * `pendingKey` is the odd column, and it exists to answer a question a
 * unique index cannot ask on its own: allow only one PENDING inquiry per
 * (inquirer, listing), but let an unlimited number of finished ones
 * accumulate. The trick is that the column holds `<listingId>:<inquirerId>`
 * only while the status is PENDING and is set to NULL the moment it is not.
 * PostgreSQL never compares two NULLs for uniqueness, so closed inquiries
 * cannot collide with each other, while a second live one is rejected by the
 * unique index on this column.
 *
 * `sharedContact` is what the owner hands over when they accept — the point of
 * the whole flow — and it is only ever what they typed into that request, never
 * a value the server looked up for them. `ownerResponse` is their reply on the
 * way in.
 */
@Entity('inquiries')
@Index(['listingId', 'inquirerId', 'status'])
@Index(['ownerId', 'status'])
@Index(['inquirerId', 'status'])
export class Inquiry {
  @PrimaryColumn('text')
  id!: string;

  @Column('text')
  listingId!: string;

  @Column('text')
  inquirerId!: string;

  @Column('text')
  ownerId!: string;

  @Column({ type: 'enum', enum: InquiryStatus, default: InquiryStatus.PENDING })
  status!: InquiryStatus;

  @Column('text')
  message!: string;

  @Column('text', { nullable: true })
  sharedContact!: string | null;

  @Column('text', { nullable: true })
  ownerResponse!: string | null;

  /** `<listingId>:<inquirerId>` while PENDING, NULL at every other status. */
  @Column('text', { nullable: true, unique: true })
  pendingKey!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  @ManyToOne('Listing', 'inquiries', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'listingId' })
  listing!: Listing;

  @ManyToOne('User', 'inquiriesSent', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'inquirerId' })
  inquirer!: User;

  @ManyToOne('User', 'inquiriesReceived', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'ownerId' })
  owner!: User;

  @BeforeInsert()
  assignId(): void {
    this.id ??= newId();
  }
}
