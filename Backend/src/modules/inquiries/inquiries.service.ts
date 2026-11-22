import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Inquiry, Listing, User } from '../../database/entities/index';
import { InquiryStatus, ListingStatus, NotificationType } from '../../database/schema';
import { UsersService } from '../users/users.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  buildPageMeta,
  page,
  toSkipTake,
  type PaginationQueryDto,
} from '../../common/dto/pagination';
import { Errors } from '../../common/errors';
import { isDuplicateKey } from '../../common/helpers/is-duplicate-key';
import type { CreateInquiryDto, RespondInquiryDto } from './dto/inquiry.dto';

/** The two students on an inquiry, as the thread view shows them. */
interface PersonSummary {
  id: string;
  name: string;
  image: string | null;
  department: string | null;
}

interface ListingSummary {
  id: string;
  title: string;
  category: Listing['category'];
  status: Listing['status'];
  ownerId: string;
}

/**
 * An inquiry as this service handles it: the entity's columns minus the
 * `@BeforeInsert` helper, which only matters while a row is being written.
 * Reading a row and adding a listing title to it produces a plain object of
 * exactly this shape, not a class instance.
 */
type InquiryRow = Omit<Inquiry, 'assignId'>;

/** An inquiry with the three rows a thread header is made of. */
interface LoadedInquiry {
  inquiry: InquiryRow;
  listing: ListingSummary;
  inquirer: PersonSummary;
  owner: PersonSummary;
}

const TRANSITIONS: Record<InquiryStatus, InquiryStatus[]> = {
  [InquiryStatus.PENDING]: [
    InquiryStatus.ACCEPTED,
    InquiryStatus.DECLINED,
    InquiryStatus.CANCELLED,
  ],
  [InquiryStatus.ACCEPTED]: [InquiryStatus.CANCELLED],
  [InquiryStatus.DECLINED]: [],
  [InquiryStatus.CANCELLED]: [],
};

function pendingKeyFor(listingId: string, inquirerId: string) {
  return `${listingId}:${inquirerId}`;
}

function toPerson(user: User): PersonSummary {
  return {
    id: user.id,
    name: user.name,
    image: user.image,
    department: user.department,
  };
}

@Injectable()
export class InquiriesService {
  constructor(
    @InjectRepository(Inquiry)
    private readonly inquiries: Repository<Inquiry>,
    @InjectRepository(Listing)
    private readonly listings: Repository<Listing>,
    @InjectRepository(User)
    private readonly accounts: Repository<User>,
    private readonly users: UsersService,
    private readonly notifications: NotificationsService,
  ) {}

  async submit(inquirerId: string, dto: CreateInquiryDto) {
    const listing = await this.listings.findOne({
      where: { id: dto.listingId },
      select: { id: true, title: true, status: true, ownerId: true },
    });
    if (!listing) {
      throw Errors.listingNotFound();
    }
    await this.assertInquirable(inquirerId, listing);

    const created = await this.openRow(inquirerId, listing, dto);

    await this.notifications.notify({
      userId: listing.ownerId,
      type: NotificationType.INQUIRY_RECEIVED,
      title: `New inquiry about "${listing.title}"`,
      body: 'Someone wants to reach you. Review it in your inquiries.',
      link: `/inquiries/${created.id}`,
    });

    return this.presentOne(created, inquirerId);
  }

  /**
   * The three rules that decide whether this student may start this thread,
   * checked in the order whose answer a client expects: is it yours, is it
   * still open, and are you two on speaking terms.
   */
  private async assertInquirable(
    inquirerId: string,
    listing: { ownerId: string; status: Listing['status'] },
  ): Promise<void> {
    if (listing.ownerId === inquirerId) {
      throw new BadRequestException({
        code: 'SELF_INQUIRY',
        message: 'You cannot inquire about your own listing',
      });
    }
    if (listing.status !== ListingStatus.ACTIVE) {
      throw new BadRequestException({
        code: 'LISTING_NOT_ACTIVE',
        message: 'This listing no longer accepts inquiries',
      });
    }
    if (await this.users.areBlocked(inquirerId, listing.ownerId)) {
      throw Errors.blockedContact();
    }
  }

  /**
   * One row per student per listing in `PENDING`, and nothing else.
   *
   * The read is what gives an ordinary duplicate its message; the insert is what
   * makes the rule true. Two submissions from the same student on the same
   * listing can both pass the read, and only the unique `pendingKey` settles
   * that — in the database, not in application code.
   */
  private async openRow(
    inquirerId: string,
    listing: { id: string; ownerId: string },
    dto: CreateInquiryDto,
  ): Promise<Inquiry> {
    const pending = await this.inquiries.findOne({
      where: { listingId: listing.id, inquirerId, status: InquiryStatus.PENDING },
      select: { id: true },
    });
    if (pending) {
      throw Errors.inquiryAlreadyPending();
    }

    try {
      return await this.inquiries.save(
        this.inquiries.create({
          listingId: listing.id,
          inquirerId,
          ownerId: listing.ownerId,
          message: dto.message.trim(),
          pendingKey: pendingKeyFor(listing.id, inquirerId),
        }),
      );
    } catch (error) {
      if (isDuplicateKey(error)) {
        throw Errors.inquiryAlreadyPending();
      }
      throw error;
    }
  }

  async list(
    userId: string,
    direction: 'sent' | 'received',
    status: InquiryStatus | 'ALL',
    pagination: PaginationQueryDto,
  ) {
    const where = {
      ...(direction === 'sent' ? { inquirerId: userId } : { ownerId: userId }),
      ...(status === 'ALL' ? {} : { status }),
    };
    const [rows, total] = await this.inquiries.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      ...toSkipTake(pagination),
    });
    const loaded = await this.attach(rows);
    return page(
      loaded.map((item) => this.present(item, userId)),
      buildPageMeta(pagination, total),
    );
  }

  async detail(userId: string, id: string) {
    const inquiry = await this.findInquiry(id);
    if (inquiry.inquirerId !== userId && inquiry.ownerId !== userId) {
      throw new ForbiddenException({ code: 'NOT_PARTICIPANT', message: 'Not your inquiry' });
    }
    return this.presentOne(inquiry, userId);
  }

  async respond(
    ownerId: string,
    id: string,
    decision: 'ACCEPTED' | 'DECLINED',
    dto: RespondInquiryDto,
  ) {
    const inquiry = await this.findInquiry(id);
    if (inquiry.ownerId !== ownerId) {
      throw new ForbiddenException({
        code: 'NOT_OWNER',
        message: 'Only the listing owner can respond to an inquiry',
      });
    }
    this.assertTransition(inquiry.status, decision);

    if (
      decision === InquiryStatus.ACCEPTED &&
      (await this.users.areBlocked(ownerId, inquiry.inquirerId))
    ) {
      throw Errors.blockedContact();
    }

    const accepted = decision === InquiryStatus.ACCEPTED;
    const sharedContact = this.contactToShare(decision, dto);
    const response = dto.response?.trim();
    const updated = await this.applyDecision(
      id,
      inquiry.status,
      decision,
      response ?? null,
      sharedContact,
    );

    await this.notifications.notify({
      userId: inquiry.inquirerId,
      type: accepted ? NotificationType.INQUIRY_ACCEPTED : NotificationType.INQUIRY_DECLINED,
      title: accepted ? 'Your inquiry was accepted' : 'Your inquiry was declined',
      body: response ?? `Regarding "${updated.listingTitle}"`,
      link: `/inquiries/${id}`,
    });

    return this.presentOne(updated, ownerId);
  }

  /**
   * Writes the decision and reads the row back for the response body.
   *
   * `pendingKey` is cleared on purpose: the row is no longer pending, so the
   * student may open a new inquiry on the same listing later.
   *
   * The status that was checked a few lines above is part of the `where`, so the
   * write is the check: two owners answering the same pending inquiry cannot both
   * get through, and the loser is refused here — before the notification below
   * tells the inquirer anything.
   */
  private async applyDecision(
    id: string,
    from: InquiryStatus,
    decision: 'ACCEPTED' | 'DECLINED',
    ownerResponse: string | null,
    sharedContact: string | null,
  ) {
    const written = await this.inquiries.update(
      { id, status: from },
      { status: decision, ownerResponse, sharedContact, pendingKey: null },
    );
    if (written.affected === 0) {
      throw this.invalidTransition(from, decision);
    }
    return this.findInquiry(id);
  }

  /**
   * What the inquirer may now use to reach the owner: only what the owner typed
   * into this request. A decline shares nothing, and so does an acceptance that
   * named no contact.
   *
   * An acceptance is not an offer to be contacted, so it cannot be the event that
   * reveals a phone number: writing the value in the request is the one place the
   * owner sees it before the other student does. `CHANGELOG.md` → "Accepting an
   * inquiry shares a contact only if the owner sends one" says what was here.
   */
  private contactToShare(decision: 'ACCEPTED' | 'DECLINED', dto: RespondInquiryDto): string | null {
    if (decision !== InquiryStatus.ACCEPTED) return null;
    return dto.sharedContact?.trim() || null;
  }

  async cancel(userId: string, id: string) {
    const inquiry = await this.findInquiry(id);
    if (inquiry.inquirerId !== userId) {
      throw new ForbiddenException({
        code: 'NOT_INQUIRER',
        message: 'Only the sender can cancel an inquiry',
      });
    }
    this.assertTransition(inquiry.status, InquiryStatus.CANCELLED);
    // Same as in `applyDecision()`: the status that was read is the status the
    // write is allowed to replace, so a decision typed into the other tab of the
    // same thread loses here rather than after the owner has been told.
    const written = await this.inquiries.update(
      { id, status: inquiry.status },
      { status: InquiryStatus.CANCELLED, pendingKey: null },
    );
    if (written.affected === 0) {
      throw this.invalidTransition(inquiry.status, InquiryStatus.CANCELLED);
    }
    const updated = await this.findInquiry(id);

    await this.notifications.notify({
      userId: inquiry.ownerId,
      type: NotificationType.INQUIRY_RESPONSE,
      title: 'An inquiry was cancelled',
      body: `Regarding "${updated.listingTitle}"`,
      link: `/inquiries/${id}`,
    });

    return this.presentOne(updated, userId);
  }

  /** Convenience for listing owners who want to respond to a pending inquiry. */
  async messageInquirer(userId: string, id: string, dto: RespondInquiryDto) {
    const inquiry = await this.findInquiry(id);
    if (inquiry.ownerId !== userId) {
      throw new ForbiddenException({
        code: 'NOT_OWNER',
        message: 'Only the owner can add a response',
      });
    }
    if (inquiry.status !== InquiryStatus.ACCEPTED) {
      throw new BadRequestException({
        code: 'NOT_ACCEPTED',
        message: 'Follow-up messages are only allowed on accepted inquiries',
      });
    }
    if (await this.users.areBlocked(userId, inquiry.inquirerId)) {
      throw Errors.blockedContact();
    }
    const response = dto.response?.trim();
    // `accept` and `decline` let the field go absent — an acceptance with no note
    // is a decision, not a message. Here the reply is the whole request, so an
    // empty one is refused rather than written over the owner's last answer and
    // announced to the other student as "New reply to your inquiry" with nothing
    // in it.
    if (!response) {
      throw new BadRequestException({
        code: 'EMPTY_RESPONSE',
        message: 'Write a reply first',
      });
    }
    // The status read above is part of the write, exactly as it is in
    // `applyDecision()` and `cancel()`: an owner who replies in one tab while a
    // decline lands in another must not leave a message inside a thread the
    // inquirer has already been told is closed — and must not be told it worked.
    const written = await this.inquiries.update(
      { id, status: InquiryStatus.ACCEPTED },
      { ownerResponse: response },
    );
    if (written.affected === 0) {
      const current = await this.findInquiry(id);
      throw this.invalidTransition(current.status, InquiryStatus.ACCEPTED);
    }

    await this.notifications.notify({
      userId: inquiry.inquirerId,
      type: NotificationType.INQUIRY_RESPONSE,
      title: 'New reply to your inquiry',
      body: response,
      link: `/inquiries/${id}`,
    });

    const updated = await this.findInquiry(id);
    return this.presentOne(updated, userId);
  }

  /* ---------------------------------------------------------------- loading --- */

  /**
   * The row plus the title of the listing it is about.
   *
   * The title is read here rather than left to `attach` because the notification
   * text is written before the response body is assembled, and "Regarding" with
   * no subject in it is a message nobody can act on.
   */
  private async findInquiry(id: string) {
    const inquiry = await this.inquiries.findOne({ where: { id } });
    if (!inquiry)
      throw new NotFoundException({ code: 'INQUIRY_NOT_FOUND', message: 'Unknown inquiry' });
    const listing = await this.listings.findOne({
      where: { id: inquiry.listingId },
      select: { title: true },
    });
    return { ...inquiry, listingTitle: listing?.title ?? '' };
  }

  /** Listing, inquirer and owner for a page of inquiries, in two queries. */
  private async attach(rows: InquiryRow[]): Promise<LoadedInquiry[]> {
    if (!rows.length) return [];
    const userIds = new Set<string>();
    for (const row of rows) {
      userIds.add(row.inquirerId);
      userIds.add(row.ownerId);
    }
    const [listings, people] = await Promise.all([
      this.listings.find({ where: { id: In([...new Set(rows.map((row) => row.listingId))]) } }),
      this.accounts.find({ where: { id: In([...userIds]) } }),
    ]);

    const listingById = new Map(listings.map((listing) => [listing.id, listing]));
    const personById = new Map(people.map((person) => [person.id, person]));
    // The three `!`s below are safe for the same reason: every id being looked
    // up came out of the rows that are being displayed, and all three foreign
    // keys are ON DELETE CASCADE — an inquiry cannot outlive its listing or
    // either of its students. `Map.get` cannot know that, so the type says
    // "maybe" where the database says "no".

    return rows.map((inquiry) => {
      const listing = listingById.get(inquiry.listingId)!;
      return {
        inquiry,
        listing: {
          id: listing.id,
          title: listing.title,
          category: listing.category,
          status: listing.status,
          ownerId: listing.ownerId,
        },
        inquirer: toPerson(personById.get(inquiry.inquirerId)!),
        owner: toPerson(personById.get(inquiry.ownerId)!),
      };
    });
  }

  private assertTransition(from: InquiryStatus, to: InquiryStatus) {
    if (!TRANSITIONS[from].includes(to)) {
      throw this.invalidTransition(from, to);
    }
  }

  /**
   * The refusal for an inquiry that is not in the status the write expected.
   *
   * Both the read-ahead check and a write that lost the race answer with it, so
   * a client cannot tell the difference between "this thread was already
   * answered" and "somebody answered it between your two requests" — and has no
   * reason to.
   */
  private invalidTransition(from: InquiryStatus, to: InquiryStatus) {
    return new BadRequestException({
      code: 'INVALID_TRANSITION',
      message: `An inquiry in ${from} cannot move to ${to}`,
    });
  }

  /**
   * The thread view of one inquiry — the row, its listing, and the two students
   * — read the same way a page of them is read.
   */
  private async presentOne(inquiry: InquiryRow, viewerId: string) {
    const [loaded] = await this.attach([inquiry]);
    return this.present(loaded, viewerId);
  }

  private present(loaded: LoadedInquiry, viewerId: string) {
    const { inquiry, listing } = loaded;
    const isOwner = inquiry.ownerId === viewerId;
    return {
      id: inquiry.id,
      status: inquiry.status,
      message: inquiry.message,
      ownerResponse: inquiry.ownerResponse,
      // Contact details are revealed to the inquirer only once the owner accepts.
      sharedContact: inquiry.status === InquiryStatus.ACCEPTED ? inquiry.sharedContact : null,
      listing: {
        id: listing.id,
        title: listing.title,
        category: listing.category,
        listingStatus: listing.status,
      },
      inquirer: isOwner ? loaded.inquirer : undefined,
      owner: !isOwner ? loaded.owner : undefined,
      counterpart: isOwner ? loaded.inquirer : loaded.owner,
      createdAt: inquiry.createdAt,
      updatedAt: inquiry.updatedAt,
      canCancel:
        !isOwner &&
        (inquiry.status === InquiryStatus.PENDING || inquiry.status === InquiryStatus.ACCEPTED),
      canRespond: isOwner && inquiry.status === InquiryStatus.PENDING,
    };
  }
}
