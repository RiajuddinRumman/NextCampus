import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

/**
 * `?page=&limit=` accepted by every list endpoint.
 *
 * The `@Type` decorators matter: a query string is always text, so `limit=20`
 * reaches the server as `'20'`. class-transformer converts it before the rules
 * run, which is what lets `@IsInt()` pass and lets services do arithmetic.
 */
export class PaginationQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  // 100 is the global ceiling; endpoints that list user-facing searches cap
  // lower in their own DTO to keep responses small.
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}

export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/** Turns a page request into the `skip`/`take` pair the data layer expects. */
export function toSkipTake(query: PaginationQueryDto) {
  return { skip: (query.page - 1) * query.limit, take: query.limit };
}

/** Builds the `meta` block clients use to draw pagination controls. */
export function buildPageMeta(query: PaginationQueryDto, total: number): PageMeta {
  return {
    page: query.page,
    limit: query.limit,
    total,
    // An empty result is still one page: a UI that shows "page 1 of 0" looks broken.
    totalPages: Math.max(1, Math.ceil(total / query.limit)),
  };
}

/**
 * Marker for a paginated controller result. The envelope interceptor unwraps
 * it into `{ data, meta }`; anything else a handler returns becomes `data`,
 * including a listing whose own payload is called `data`.
 */
export class Paged<T> {
  constructor(
    readonly items: T[],
    readonly meta: PageMeta,
  ) {}
}

export function page<T>(items: T[], meta: PageMeta): Paged<T> {
  return new Paged(items, meta);
}
