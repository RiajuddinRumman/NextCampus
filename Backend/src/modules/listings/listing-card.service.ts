import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Listing, ListingImage, User } from '../../database/entities/index';
import { ListingCategory, ListingStatus } from '../../database/schema';

/** The owner as a listing card shows them: enough to recognise a person, no contact data. */
export interface ListingOwner {
  id: string;
  name: string;
  image: string | null;
  department: string | null;
}

export interface ListingImageRef {
  id: string;
  url: string;
  createdAt: Date;
}

/** A listing with the two things every card needs, loaded in one batch. */
export interface LoadedListing {
  listing: Listing;
  owner: ListingOwner;
  images: ListingImageRef[];
}

/**
 * One listing as the API answers with it.
 *
 * `status` is optional because it is the one key whose presence depends on the
 * viewer: owners and staff are told whether a listing is closed or hidden, and
 * no other card carries it.
 */
export interface ListingCard {
  id: string;
  category: ListingCategory;
  title: string;
  description: string;
  data: Record<string, unknown>;
  locationText: string | null;
  price: string | null;
  currency: string;
  closesAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  images: ListingImageRef[];
  owner: ListingOwner;
  isOwner: boolean;
  status?: ListingStatus;
}

/** Who a card is built for, and how much of it they are allowed to see. */
export interface PresentOptions {
  viewerId?: string;
  privileged: boolean;
}

function toOwner(user: User): ListingOwner {
  return {
    id: user.id,
    name: user.name,
    image: user.image,
    department: user.department,
  };
}

/**
 * The response shape of every listing route, and the two reads that fill it.
 *
 * The service builds a listing; this decides what a caller is *shown* about it —
 * which is a separate responsibility because the same row answers differently
 * for the owner, a stranger, a blocked student and a moderator, and every route
 * here (search, detail, the owner's own list, the hidden queue, and the answer
 * of a write) needs the same answer. Left in `ListingsService` it was the reason
 * that file reached six hundred lines: not the rules, but the shape.
 */
@Injectable()
export class ListingCardService {
  constructor(
    @InjectRepository(ListingImage)
    private readonly images: Repository<ListingImage>,
    @InjectRepository(User)
    private readonly accounts: Repository<User>,
  ) {}

  /**
   * Owner and images for a page of listings, in two queries.
   *
   * A join would have worked too, but it repeats the listing row once per image
   * and then asks the driver to fold the result back up. Two flat reads and a
   * Map in memory is both cheaper and easier to see at a glance — and it keeps
   * this method the only place that knows what a listing card is made of.
   */
  async attach(rows: Listing[]): Promise<LoadedListing[]> {
    if (!rows.length) return [];
    const [owners, pictures] = await Promise.all([
      this.accounts.find({ where: { id: In([...new Set(rows.map((row) => row.ownerId))]) } }),
      this.images.find({
        where: { listingId: In(rows.map((row) => row.id)) },
        order: { createdAt: 'ASC' },
      }),
    ]);

    const ownerById = new Map(owners.map((owner) => [owner.id, owner]));
    const imagesByListing = new Map<string, ListingImage[]>();
    for (const image of pictures) {
      const bucket = imagesByListing.get(image.listingId) ?? [];
      bucket.push(image);
      imagesByListing.set(image.listingId, bucket);
    }

    return rows.map((listing) => ({
      listing,
      owner: toOwner(ownerById.get(listing.ownerId)!),
      images: (imagesByListing.get(listing.id) ?? []).map((image) => ({
        id: image.id,
        url: image.url,
        createdAt: image.createdAt,
      })),
    }));
  }

  /** The answer of a single-listing route: attach the owner and pictures, then present. */
  async presentOne(listing: Listing, options: PresentOptions): Promise<ListingCard> {
    const [loaded] = await this.attach([listing]);
    return this.present(loaded, options);
  }

  present(loaded: LoadedListing, options: PresentOptions): ListingCard {
    const { listing } = loaded;
    const card: ListingCard = {
      id: listing.id,
      category: listing.category,
      title: listing.title,
      description: listing.description,
      data: listing.data,
      locationText: listing.locationText,
      // Decimal reaches JSON as a string; converting to a number would risk
      // losing precision on money.
      price: listing.price,
      currency: listing.currency,
      closesAt: listing.closesAt,
      createdAt: listing.createdAt,
      updatedAt: listing.updatedAt,
      images: loaded.images,
      owner: loaded.owner,
      isOwner: Boolean(options.viewerId && options.viewerId === listing.ownerId),
    };
    // Public listings are ACTIVE by definition; owners and staff also learn
    // when something is closed or hidden.
    if (options.privileged) card.status = listing.status;
    return card;
  }
}
