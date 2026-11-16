import { ForbiddenException } from '@nestjs/common';
import type { SelectQueryBuilder } from 'typeorm';
import { Listing } from '../../database/entities/index';
import { ListingStatus, Role } from '../../database/schema';
import { isStaff } from '../../common/helpers/staff';
import { likePattern } from '../../common/helpers/like-pattern';
import type { SearchListingsQueryDto } from './dto/listing.dto';

/**
 * The search query, assembled one clause at a time.
 *
 * These functions are the whole reason `search()` cannot be a `where` object:
 * two parts of the filter cannot be said that way at all — the category-specific
 * fields live inside a JSONB document, and a text search has to look in two
 * columns at once. Everything else here is an ordinary WHERE, and it is written
 * the same way as those two so the assembled statement is readable in one place
 * rather than split between a builder and a filter object.
 *
 * Nothing here is a method because nothing here has state: each takes the
 * builder it was handed and adds to it. That also keeps them out of the service,
 * where a reviewer would otherwise have to hold both the route rules and the SQL
 * shapes in mind at once.
 */

/** Whose request this is, as far as a listing cares: their id and their role. */
export interface Viewer {
  id: string;
  role: Role;
}

/**
 * Which listings this caller may have at all — the status rules and the blocks —
 * decided before any other filter, then the plain columns, then the ones inside
 * the category document.
 */
export function applyFilters(
  builder: SelectQueryBuilder<Listing>,
  query: SearchListingsQueryDto,
  viewer?: Viewer,
): void {
  applyStatusScope(builder, query, viewer);
  applyBlockScope(builder, viewer);
  applyColumnFilters(builder, query);
  applyCategoryFields(builder, query);
}

/**
 * A student who has blocked somebody, or been blocked by them, does not get
 * their notice boards in a search. Both directions, because a block is a two-way
 * door everywhere else (`areBlocked` answers true for either) and because the
 * alternative is a search result that links to a page which refuses to show who
 * posted it.
 *
 * It is a `NOT EXISTS` inside this statement rather than a list of ids read
 * first, so it also subtracts from the count the pagination is built on — a
 * `total` that still includes the hidden posts is a page that never fills.
 *
 * Staff are not exempted: a moderator investigating a block reads the row by id
 * through the moderation routes, and `GET /api/listings/:id` keeps its limited
 * `blocked` view for the case where the post itself has to be seen.
 */
function applyBlockScope(builder: SelectQueryBuilder<Listing>, viewer?: Viewer): void {
  if (!viewer) return;
  builder.andWhere(
    `NOT EXISTS (
       SELECT 1 FROM "blocks" block
       WHERE (block."blockerId" = listing.ownerId AND block."blockedId" = :blockViewerId)
          OR (block."blockerId" = :blockViewerId AND block."blockedId" = listing.ownerId)
     )`,
    { blockViewerId: viewer.id },
  );
}

/**
 * Closed listings are a private view: an owner searches their own catalogue,
 * staff search the platform, nobody else may ask.
 */
function applyStatusScope(
  builder: SelectQueryBuilder<Listing>,
  query: SearchListingsQueryDto,
  viewer?: Viewer,
): void {
  builder.where('listing.status = :status', { status: query.status });

  if (query.status === ListingStatus.CLOSED) {
    if (isStaff(viewer?.role)) {
      if (query.ownerId) {
        builder.andWhere('listing.ownerId = :ownerId', { ownerId: query.ownerId });
      }
    } else {
      const askedForOthers = query.ownerId !== undefined && query.ownerId !== viewer?.id;
      if (!viewer || askedForOthers) {
        throw new ForbiddenException({
          code: 'CLOSED_SEARCH_FORBIDDEN',
          message: 'Closed listings can only be searched by their owner or by staff',
        });
      }
      builder.andWhere('listing.ownerId = :ownerId', { ownerId: viewer.id });
    }
  } else if (query.ownerId) {
    builder.andWhere('listing.ownerId = :ownerId', { ownerId: query.ownerId });
  }
}

/** The filters that are a plain column of the listing row. */
function applyColumnFilters(builder: SelectQueryBuilder<Listing>, query: SearchListingsQueryDto) {
  if (query.category) {
    builder.andWhere('listing.category = :category', { category: query.category });
  }
  if (query.location) {
    builder.andWhere('listing.locationText ILIKE :location', {
      location: likePattern(query.location),
    });
  }
  if (query.minPrice !== undefined) {
    builder.andWhere('listing.price >= :minPrice', { minPrice: query.minPrice });
  }
  if (query.maxPrice !== undefined) {
    builder.andWhere('listing.price <= :maxPrice', { maxPrice: query.maxPrice });
  }
  if (query.closesBefore) {
    builder.andWhere('listing.closesAt <= :closesBefore', { closesBefore: query.closesBefore });
  }
  if (query.q) {
    builder.andWhere('(listing.title ILIKE :q OR listing.description ILIKE :q)', {
      q: likePattern(query.q),
    });
  }
}

/** The filters that live inside the category document rather than a column. */
function applyCategoryFields(builder: SelectQueryBuilder<Listing>, query: SearchListingsQueryDto) {
  // One equality per key inside the JSON document.
  const scalars: Array<[string, string | undefined]> = [
    ['intent', query.intent],
    ['condition', query.condition],
    ['level', query.level],
    ['purpose', query.purpose],
    ['reportType', query.reportType],
    ['transportType', query.transportType],
    ['listingType', query.listingType],
  ];
  scalars.forEach(([key, value], index) => {
    if (value === undefined) return;
    builder.andWhere(`listing.data ->> :key${index} = :value${index}`, {
      [`key${index}`]: key,
      [`value${index}`]: value,
    });
  });

  // The two ends of a commute route, matched as text for the same reason
  // `locationText` is: the student typed them, in their own spelling of a place.
  const texts: Array<[string, string | undefined]> = [
    ['fromArea', query.fromArea],
    ['toArea', query.toArea],
  ];
  texts.forEach(([key, value], index) => {
    // An empty `?fromArea=` is the filter not being asked for, not a search for
    // the empty string — the same reading `subject` has always had.
    if (!value) return;
    builder.andWhere(`listing.data ->> :textKey${index} ILIKE :textValue${index}`, {
      [`textKey${index}`]: key,
      [`textValue${index}`]: likePattern(value),
    });
  });

  // One array-membership test per list a post can carry. `subject` is the same
  // question asked of a tuition post, `day` of a commute post's schedule, and
  // the two group ones of what a team still needs.
  const members: Array<[string, string | undefined]> = [
    ['subjects', query.subject],
    ['days', query.day],
    ['requiredSkills', query.skill],
    ['rolesNeeded', query.roleNeeded],
  ];
  members.forEach(([key, value], index) => {
    if (!value) return;
    // `jsonb_exists(document->key, value)` is the `?` operator written as a
    // function, because `?` is how parameters are numbered in a query.
    builder.andWhere(`jsonb_exists(listing.data -> :memberKey${index}, :memberValue${index})`, {
      [`memberKey${index}`]: key,
      [`memberValue${index}`]: value,
    });
  });
}

export function applyOrder(
  builder: SelectQueryBuilder<Listing>,
  sort: SearchListingsQueryDto['sort'],
): void {
  switch (sort) {
    case 'price_asc':
      builder.orderBy('listing.price', 'ASC').addOrderBy('listing.createdAt', 'DESC');
      break;
    case 'price_desc':
      builder.orderBy('listing.price', 'DESC').addOrderBy('listing.createdAt', 'DESC');
      break;
    case 'oldest':
      builder.orderBy('listing.createdAt', 'ASC');
      break;
    default:
      builder.orderBy('listing.createdAt', 'DESC');
  }
}
