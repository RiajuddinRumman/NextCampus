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
import { newId } from '../../../database/schema';
import type { Listing } from './listing.entity';
import type { User } from '../../users/entities/user.entity';

/**
 * One attached image of one listing.
 *
 * `uploaderId` is recorded next to `listingId` because a picture can be added
 * to someone else's listing by a moderator acting for the owner, and the
 * question "who put this on the internet?" needs an answer on the row itself
 * rather than an inference from who owned the listing at the time.
 *
 * Deleting the listing or the account removes these rows through
 * `ON DELETE CASCADE`, so no picture can outlive either of them. What it does
 * not do is delete the file in Cloudinary — that is a separate call, which is
 * why `ListingsService` removes the images before the listing itself.
 */
@Entity('listing_images')
@Index(['listingId'])
export class ListingImage {
  @PrimaryColumn('text')
  id!: string;

  @Column('text')
  listingId!: string;

  /** The URL Cloudinary gave the upload, not a byte stored here. */
  @Column('text')
  url!: string;

  @Column('text')
  uploaderId!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @ManyToOne('Listing', 'images', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'listingId' })
  listing!: Listing;

  @ManyToOne('User', 'listingImages', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'uploaderId' })
  uploader!: User;

  @BeforeInsert()
  assignId(): void {
    this.id ??= newId();
  }
}
