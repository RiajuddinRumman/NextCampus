import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Not, Repository, type EntityManager } from 'typeorm';
import {
  Inquiry,
  Listing,
  ListingImage,
  Notification,
  User,
} from '../../database/entities/index';
import {
  InquiryStatus,
  ListingCategory,
  ListingStatus,
  NotificationType,
} from '../../database/schema';
import { UsersService } from '../users/users.service';
import { ImageUrlPolicy } from '../media/image-url-policy';
import {
  buildPageMeta,
  page,
  toSkipTake,
  type PaginationQueryDto,
} from '../../common/dto/pagination';
import { Errors } from '../../common/errors';
import { hasPatchValues } from '../../common/helpers/has-patch-values';
import { isStaff } from '../../common/helpers/staff';
import { validateCategoryData } from './listing-category.dto';
import { applyFilters, applyOrder, type Viewer } from './listing-filters';
import { ListingCardService } from './listing-card.service';
import type {
  CreateListingDto,
  ListingWriteStatus,
  MineListingsStatus,
  SearchListingsQueryDto,
  UpdateListingDto,
} from './dto/listing.dto';

/**
 * What a student reads where an answer to their question should have been, when
 * the listing closes first. The same text goes into the thread and into the
 * notification about it, so the inbox and the page it links to cannot disagree.
 */
const CLOSED_LISTING_RESPONSE = 'This listing was closed.';

/**
 * The five notice boards: what a student posts and what they may ask for.
 *
 * Deliberately not in this file: the shape of an answer (`ListingCardService`,
 * which every route here ends in), search SQL (`applyFilters`/`applyOrder` in
 * `listing-filters.ts`), and hide/unhide (`ModerationService`, which writes the
 * row and its audit entry in one transaction). What is left is the write rules
 * an owner has and the four student reads.
 */
@Injectable()
export class ListingsService {
  static readonly MAX_ACTIVE_LISTINGS = 50;

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Listing)
    private readonly listings: Repository<Listing>,
    private readonly users: UsersService,
    private readonly ownedImages: ImageUrlPolicy,
    private readonly cards: ListingCardService,
  ) {}

  async create(ownerId: string, dto: CreateListingDto) {
    const data = this.validatedData(dto.category, dto.data);
    this.ownedImages.assertListingImages(dto.imageUrls, ownerId);

    const listing = await this.dataSource.transaction(async (manager) => {
      await this.ensureRoomForActiveListing(manager, ownerId);

      const created = await manager.save(
        manager.create(Listing, {
          ownerId,
          category: dto.category,
          title: dto.title.trim(),
          description: dto.description.trim(),
          data,
          locationText: dto.locationText?.trim() ?? null,
          // `== null`, not `=== undefined`: a body may send `"price": null` to
          // mean "no asking price", and `String(null)` would store the word.
          price: dto.price == null ? null : String(dto.price),
          currency: dto.currency,
          closesAt: dto.closesAt ?? null,
        }),
      );
      if (dto.imageUrls.length) {
        await manager.save(
          manager.create(ListingImage, this.imageRows(created.id, ownerId, dto.imageUrls)),
        );
      }
      return created;
    });

    return this.cards.presentOne(listing, { viewerId: ownerId, privileged: true });
  }

  /**
   * The public catalogue. Privilege is decided here rather than in the query:
   * anything other than active listings is the private view, so `status` only
   * rides on a card the caller asked for as staff or as the owner.
   */
  async search(query: SearchListingsQueryDto, viewer?: Viewer) {
    const builder = this.listings.createQueryBuilder('listing');
    applyFilters(builder, query, viewer);
    applyOrder(builder, query.sort);

    const { skip, take } = toSkipTake(query);
    const [rows, total] = await builder.skip(skip).take(take).getManyAndCount();

    const loaded = await this.cards.attach(rows);
    return page(
      loaded.map((item) =>
        this.cards.present(item, {
          viewerId: viewer?.id,
          privileged: query.status !== ListingStatus.ACTIVE,
        }),
      ),
      buildPageMeta(query, total),
    );
  }

  async mine(ownerId: string, status: MineListingsStatus, pagination: PaginationQueryDto) {
    const [rows, total] = await this.listings.findAndCount({
      where: { ownerId, ...(status === 'ALL' ? {} : { status }) },
      order: { updatedAt: 'DESC' },
      ...toSkipTake(pagination),
    });
    const loaded = await this.cards.attach(rows);
    return page(
      loaded.map((item) => this.cards.present(item, { viewerId: ownerId, privileged: true })),
      buildPageMeta(pagination, total),
    );
  }

  async detail(id: string, viewer?: Viewer) {
    const listing = await this.findListing(id);
    const isOwner = viewer?.id === listing.ownerId;
    const staff = isStaff(viewer?.role);
    if (listing.status === ListingStatus.HIDDEN && !isOwner && !staff) {
      throw Errors.listingNotFound();
    }

    if (!isOwner && (await this.users.areBlocked(listing.ownerId, viewer?.id ?? ''))) {
      // Content stays discoverable; the owner's identity and every contact path
      // are dropped.
      return {
        id: listing.id,
        category: listing.category,
        title: listing.title,
        description: listing.description,
        blocked: true,
        message: 'You cannot contact this student',
      };
    }

    return this.cards.presentOne(listing, { viewerId: viewer?.id, privileged: isOwner || staff });
  }

  async update(id: string, ownerId: string, dto: UpdateListingDto) {
    // Both checks below run before the ownership lookup, so an empty body and a
    // foreign image link answer the same way for someone else's listing as for
    // the caller's own.
    if (!hasPatchValues(dto)) {
      throw Errors.noFields(
        'title, description, data, locationText, price, currency, closesAt, imageUrls',
      );
    }
    this.ownedImages.assertListingImages(dto.imageUrls ?? [], ownerId);

    const updated = await this.dataSource.transaction(async (manager) => {
      // Read here, under a row lock, not before the transaction opened: the
      // `save` below rewrites every column that differs from the row as the
      // database holds it now, so a copy read earlier would put `ACTIVE` back
      // over a `HIDDEN` that landed since while the audit trail kept recording a
      // hide nobody undid. `setStatus` gets the same guarantee from
      // `status: Not(HIDDEN)` in its WHERE clause; an edit changes other columns
      // too, so it takes the lock instead. Until this transaction ends the
      // moderator's write waits, and whichever request arrives second is refused.
      const listing = this.assertOwned(await this.lockListing(manager, id), ownerId);
      this.ensureNotHidden(listing);
      if (listing.status === ListingStatus.CLOSED) {
        throw new BadRequestException({
          code: 'LISTING_CLOSED',
          message: 'Reopen the listing before editing it',
        });
      }

      this.applyEdits(listing, dto);

      if (dto.imageUrls !== undefined) {
        await manager.delete(ListingImage, { listingId: id });
        if (dto.imageUrls.length) {
          await manager.save(
            manager.create(ListingImage, this.imageRows(id, ownerId, dto.imageUrls)),
          );
        }
      }
      return manager.save(listing);
    });

    return this.cards.presentOne(updated, { viewerId: ownerId, privileged: true });
  }

  async setStatus(id: string, ownerId: string, status: ListingWriteStatus) {
    const listing = await this.ensureOwned(id, ownerId);
    this.ensureNotHidden(listing);
    await this.dataSource.transaction(async (manager) => {
      // Reopening is a road to `ACTIVE` like posting is, so it pays for the
      // ceiling too — otherwise the limit only says how fast a student may post,
      // not how much of the notice board they hold. The owner's row is locked
      // before the listing is written, which is the same order `create()` takes,
      // so a create and a reopen from one account queue instead of deadlocking.
      if (status === ListingStatus.ACTIVE) {
        await this.ensureRoomForActiveListing(manager, ownerId, id);
      }
      // HIDDEN is excluded by the write, not only by the read above: an owner
      // reopening and a moderator hiding are two requests, and the one the
      // database takes second must be the one that does nothing. Otherwise the
      // owner's `ACTIVE` silently undoes a decision the audit trail still records
      // as standing.
      const written = await manager.update(
        Listing,
        { id, ownerId, status: Not(ListingStatus.HIDDEN) },
        { status },
      );
      if (written.affected === 0) throw Errors.listingHidden();
      if (status === ListingStatus.CLOSED) await this.settlePendingInquiries(manager, id);
    });
    return this.cards.presentOne(await this.findListing(id), {
      viewerId: ownerId,
      privileged: true,
    });
  }

  /** Lost & Found reports carry their own resolution flag before closing. */
  async resolveLostFound(id: string, ownerId: string) {
    const listing = await this.ensureOwned(id, ownerId);
    this.ensureNotHidden(listing);
    if (listing.category !== ListingCategory.LOST_FOUND) {
      throw new BadRequestException({
        code: 'NOT_LOST_FOUND',
        message: 'Only lost and found reports carry a resolved flag',
      });
    }
    // `setStatus` gets this guarantee from the same `where`: an owner resolving
    // and a moderator hiding are two requests, and the one the database takes
    // second has to be the one that does nothing. Reading the status and then
    // writing by id alone let a resolve step over a hide that landed in the gap
    // and close a row moderation had just taken out of public view.
    await this.dataSource.transaction(async (manager) => {
      const written = await manager.update(
        Listing,
        { id, ownerId, status: Not(ListingStatus.HIDDEN) },
        {
          data: { ...listing.data, resolved: true },
          status: ListingStatus.CLOSED,
        },
      );
      if (written.affected === 0) throw Errors.listingHidden();
      await this.settlePendingInquiries(manager, id);
    });
    return this.cards.presentOne(await this.findListing(id), {
      viewerId: ownerId,
      privileged: true,
    });
  }

  /**
   * The threads a closing listing leaves behind, settled by the close itself.
   *
   * The two writes are one transaction because half of them is a worse state
   * than none: a listing nobody may inquire about again, with a student still
   * waiting inside it for an answer that can no longer be typed.
   *
   * Only `PENDING` moves. An `ACCEPTED` thread is two students who already
   * exchanged contacts, and ending that conversation is a decision of its own,
   * not something a notice board should take as a side effect. `pendingKey` is
   * cleared on the way out — the same as any other decision — so a student whose
   * first ask ran into a closing is free to ask again if the listing reopens.
   *
   * Each write is conditional on the status just read, the way
   * `InquiriesService.applyDecision` writes its own: an owner answering one of
   * these threads in another tab and this close are two requests, and whichever
   * reaches the row first settles it. The loser is skipped here rather than
   * overwritten, which is why the inbox rows are written after the updates and
   * only for the threads this transaction actually declined.
   *
   * Public and transaction-scoped because `ModerationService.suspendUser()`
   * settles the same threads inside its own transaction, with the suspension's
   * own words in `response` — one rule about what a student reads when the
   * answer they were promised is not coming, written in one place.
   */
  async settlePendingInquiries(
    manager: EntityManager,
    listingId: string,
    response = CLOSED_LISTING_RESPONSE,
  ): Promise<void> {
    const pending = await manager.find(Inquiry, {
      where: { listingId, status: InquiryStatus.PENDING },
      select: { id: true, inquirerId: true },
    });
    const declined: Pick<Inquiry, 'id' | 'inquirerId'>[] = [];
    for (const inquiry of pending) {
      const written = await manager.update(
        Inquiry,
        { id: inquiry.id, status: InquiryStatus.PENDING },
        {
          status: InquiryStatus.DECLINED,
          ownerResponse: response,
          pendingKey: null,
        },
      );
      if (written.affected === 1) declined.push(inquiry);
    }
    if (!declined.length) return;
    await manager.save(
      declined.map((inquiry) =>
        manager.create(Notification, {
          userId: inquiry.inquirerId,
          type: NotificationType.INQUIRY_DECLINED,
          title: 'Your inquiry was declined',
          body: response,
          link: `/inquiries/${inquiry.id}`,
        }),
      ),
    );
  }

  /** Filter values students can pick from, derived from live listings. */
  async facets(category: ListingCategory) {
    const rows = await this.listings.find({
      where: { category, status: ListingStatus.ACTIVE },
      select: { data: true, locationText: true },
      // Ordered so the 1000 rows sampled are the newest 1000 rather than
      // whichever 1000 the heap returns first; without an order the answer
      // changes between two identical requests.
      order: { createdAt: 'DESC' },
      take: 1000,
    });
    const values = (key: string) =>
      [...new Set(rows.map((row) => row.data?.[key]))]
        .filter(
          (value) =>
            typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean',
        )
        .sort();
    // The keys a search can only ask one value of at a time, because a post
    // carries a list of them: the subjects taught, the days commuted, what a
    // team still needs.
    const members = (key: string) =>
      [...new Set(rows.flatMap((row) => (row.data?.[key] as unknown[]) ?? []))].sort();
    return {
      category,
      locations: [...new Set(rows.map((row) => row.locationText).filter(Boolean))].sort(),
      conditions: values('condition'),
      levels: values('level'),
      purposes: values('purpose'),
      reportTypes: values('reportType'),
      transportTypes: values('transportType'),
      intents: values('intent'),
      listingTypes: values('listingType'),
      fromAreas: values('fromArea'),
      toAreas: values('toArea'),
      days: members('days'),
      skills: members('requiredSkills'),
      rolesNeeded: members('rolesNeeded'),
      subjects: members('subjects'),
    };
  }

  async listHidden(pagination: PaginationQueryDto) {
    const [rows, total] = await this.listings.findAndCount({
      where: { status: ListingStatus.HIDDEN },
      order: { updatedAt: 'DESC' },
      ...toSkipTake(pagination),
    });
    const loaded = await this.cards.attach(rows);
    return page(
      loaded.map((item) => this.cards.present(item, { privileged: true })),
      buildPageMeta(pagination, total),
    );
  }

  /**
   * The owner's ceiling, checked while this transaction holds their row.
   *
   * The ceiling counts rows this transaction has not written yet, so two creates
   * from one owner would both read the same total and both pass. Locking the
   * owner's row first makes the second wait for the first to commit and count
   * again — the same `pessimistic_write` read `update()` takes on the listing, on
   * the parent instead of the child.
   *
   * Both roads to `ACTIVE` come through here: a new listing, and the reopen of a
   * closed one. Without the second, the ceiling is a limit on how fast a student
   * posts rather than on how much of the notice board they hold — close fifty,
   * post fifty more, reopen the first fifty.
   *
   * `excluding` is the listing on its way to `ACTIVE`: a reopen must not count the
   * row it is about to write, or an owner already at the ceiling could not even
   * reopen the listing they just closed by mistake.
   */
  private async ensureRoomForActiveListing(
    manager: EntityManager,
    ownerId: string,
    excluding?: string,
  ): Promise<void> {
    await manager.findOne(User, {
      where: { id: ownerId },
      lock: { mode: 'pessimistic_write' },
      select: { id: true },
    });

    const active = await manager.count(Listing, {
      where: {
        ownerId,
        status: ListingStatus.ACTIVE,
        ...(excluding ? { id: Not(excluding) } : {}),
      },
    });
    if (active >= ListingsService.MAX_ACTIVE_LISTINGS) {
      throw new ForbiddenException({
        code: 'LISTING_LIMIT',
        message: `Close some listings first (max ${ListingsService.MAX_ACTIVE_LISTINGS} active)`,
      });
    }
  }

  /** One listing row, or the 404 every route here answers when it is missing. */
  private async findListing(id: string): Promise<Listing> {
    const listing = await this.listings.findOne({ where: { id } });
    if (!listing) throw Errors.listingNotFound();
    return listing;
  }

  /**
   * The category payload, checked against its own category's rules. Both write
   * routes call it before anything is stored, so a bad `data` costs the
   * database nothing.
   */
  private validatedData(category: string, payload: unknown): Record<string, unknown> {
    const validated = validateCategoryData(category, payload);
    if (!validated.ok) {
      throw new BadRequestException({
        code: 'CATEGORY_DATA_INVALID',
        message: validated.message,
        details: validated.details,
      });
    }
    return validated.data;
  }

  /** The image rows of one listing, in the order the owner sent the URLs. */
  private imageRows(
    listingId: string,
    uploaderId: string,
    urls: string[],
  ): Pick<ListingImage, 'listingId' | 'uploaderId' | 'url'>[] {
    return urls.map((url) => ({ listingId, uploaderId, url }));
  }

  /**
   * Puts the fields a patch named onto the row read for it. Only fields present
   * in the request are assigned — an absent one means "leave it as it is",
   * hence a list of ifs rather than a spread. The DTO decides what a `null`
   * does: `title`, `description`, `currency`, `data` and `imageUrls` can never
   * arrive as one (the pipe answers `VALIDATION_FAILED` naming the field), which
   * is what makes the `.trim()` calls below safe; `locationText`, `price` and
   * `closesAt` are nullable, and a null there asks for the value to be removed.
   */
  private applyEdits(listing: Listing, dto: UpdateListingDto): void {
    if (dto.title !== undefined) listing.title = dto.title.trim();
    if (dto.description !== undefined) listing.description = dto.description.trim();
    if (dto.currency !== undefined) listing.currency = dto.currency;
    if (dto.locationText !== undefined) listing.locationText = dto.locationText?.trim() || null;
    if (dto.price !== undefined) listing.price = dto.price == null ? null : String(dto.price);
    if (dto.closesAt !== undefined) listing.closesAt = dto.closesAt;
    if (dto.data !== undefined) listing.data = this.validatedData(listing.category, dto.data);
  }

  private async ensureOwned(id: string, ownerId: string) {
    return this.assertOwned(await this.findListing(id), ownerId);
  }

  /** The ownership rule, applied to a listing the caller has already read. */
  private assertOwned(listing: Listing, ownerId: string): Listing {
    if (listing.ownerId !== ownerId) {
      throw new ForbiddenException({
        code: 'NOT_OWNER',
        message: 'Only the owner can manage this listing',
      });
    }
    return listing;
  }

  /**
   * The row, write-locked, inside the caller's transaction. The lock is held
   * until that transaction ends, so nobody — a moderator hiding the listing,
   * the owner's own second request — can change the row between this read and
   * the `save` that follows. Outside a transaction it locks nothing, which is
   * why it takes the manager rather than the repository.
   */
  private async lockListing(manager: EntityManager, id: string): Promise<Listing> {
    const listing = await manager.findOne(Listing, {
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });
    if (!listing) throw Errors.listingNotFound();
    return listing;
  }

  /**
   * The owner's three writes stop at a hidden row. Hiding is a moderation
   * decision, so letting an owner reactivate, edit or resolve one would put the
   * row back in public search while the audit trail still says it is hidden.
   * `POST /api/moderation/listings/:id/unhide` is staff-only and the only way
   * back to visible.
   */
  private ensureNotHidden(listing: Listing): void {
    if (listing.status === ListingStatus.HIDDEN) throw Errors.listingHidden();
  }
}
