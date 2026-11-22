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
import { ListingCategory, ListingStatus } from '../../../database/schema';
import { newId } from '../../../database/schema';
import type { User } from '../../users/entities/user.entity';
import type { ListingImage } from './listing-image.entity';
import type { Inquiry } from '../../inquiries/entities/inquiry.entity';
import type { Report } from '../../reports/entities/report.entity';

/**
 * `900.00` -> `900`, `12.50` -> `12.5`: the digits a money value actually has,
 * without turning the text into a float on the way.
 */
function trimTrailingZeros(value: string): string {
  return value.includes('.') ? value.replace(/\.?0+$/, '') : value;
}

/**
 * Something a student offers or is looking for. One table, five categories.
 *
 * `data` is where the categories stop looking alike. Rather than a dozen
 * nullable columns of which each category uses three, the category-specific
 * fields live in one JSONB document and `listing-category.dto.ts` decides,
 * before anything is written, which keys may be there and what shape they
 * have — the database stores what the application already approved.
 *
 * `price` and `closesAt` stay real columns because search filters and orders on
 * them, and a value inside a JSON document is a poor thing to index. `price` is
 * text in the API response — see the column comment.
 *
 * `status` is ACTIVE for everyone, CLOSED for owners, HIDDEN for moderators.
 * Nobody except a moderator can set HIDDEN, and a hidden listing leaves search
 * rather than vanishing, so its owner can still see what happened to it.
 */
@Entity('listings')
@Index(['category', 'status', 'createdAt'])
@Index(['ownerId', 'status'])
export class Listing {
  @PrimaryColumn('text')
  id!: string;

  @Column('text')
  ownerId!: string;

  @Column({ type: 'enum', enum: ListingCategory })
  category!: ListingCategory;

  @Column({ type: 'enum', enum: ListingStatus, default: ListingStatus.ACTIVE })
  status!: ListingStatus;

  @Column('text')
  title!: string;

  @Column('text')
  description!: string;

  /** Category-specific fields, validated per category before they get here. */
  @Column({ type: 'jsonb', default: () => "'{}'" })
  data!: Record<string, unknown>;

  @Column('text', { nullable: true })
  locationText!: string | null;

  /**
   * An asking price. `numeric(12, 2)` comes back from Postgres as text: the
   * column can hold more digits than a JavaScript number, and money is the one
   * place where a rounding error is a bug someone pays for. So it stays text,
   * with the two scale digits trimmed — `900.00` answers as `900`.
   */
  @Column({
    type: 'numeric',
    precision: 12,
    scale: 2,
    nullable: true,
    transformer: {
      to: (value: string | number | null) => value,
      from: (value: string | null) => (value === null ? null : trimTrailingZeros(value)),
    },
  })
  price!: string | null;

  @Column('text', { default: 'BDT' })
  currency!: string;

  @Column({ type: 'timestamptz', nullable: true })
  closesAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  @ManyToOne('User', 'listings', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'ownerId' })
  owner!: User;

  @OneToMany('ListingImage', 'listing')
  images!: ListingImage[];

  @OneToMany('Inquiry', 'listing')
  inquiries!: Inquiry[];

  @OneToMany('Report', 'targetListing')
  reports!: Report[];

  @BeforeInsert()
  assignId(): void {
    this.id ??= newId();
  }
}
