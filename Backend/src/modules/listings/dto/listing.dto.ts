import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDate,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination';
import { isPresent } from '../../../common/validators/is-present';
import { ListingCategory, ListingStatus } from '../../../database/schema';
import { LISTING_TYPES, WEEK_DAYS } from '../listing-category.dto';

/**
 * The five things a student can post; each stores its extra fields in the
 * listing's `data` column, described by the DTOs in `listing-category.dto.ts`.
 * Derived from `ListingCategory` rather than listed again, so a new category is
 * added once.
 */
export const LISTING_CATEGORIES = Object.values(ListingCategory);
export type ListingCategoryName = (typeof LISTING_CATEGORIES)[number];

/** The two sides a tuition or commute post can take, and the seven commute weekdays. */
export type ListingTypeName = (typeof LISTING_TYPES)[number];
export type WeekDayName = (typeof WEEK_DAYS)[number];

/**
 * The two statuses an owner may ask search for, or hand to
 * `PATCH /api/listings/:id/status`. HIDDEN is missing on purpose: hiding is a
 * staff decision, so no student route can set it.
 */
export const LISTING_WRITE_STATUSES = [ListingStatus.ACTIVE, ListingStatus.CLOSED] as const;
export type ListingWriteStatus = (typeof LISTING_WRITE_STATUSES)[number];

/** `?status=` for `GET /api/listings/mine`, which also shows hidden rows: every status, or none. */
export type MineListingsStatus = 'ALL' | ListingStatus;
export const MINE_LISTING_STATUSES: MineListingsStatus[] = ['ALL', ...Object.values(ListingStatus)];

const MAX_IMAGES = 8;

/**
 * `?listingType=offer` is the same request as `?listingType=OFFER`: the value
 * stored in a category document is upper case, and a search box should not
 * punish a student for how the keyboard was set. Anything that is not a string
 * is passed through untouched so the validator below can refuse it by name.
 */
function toStoredCase({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.toUpperCase() : value;
}

/**
 * Body of `POST /api/listings`. `data` is validated as "some object" here and
 * per category in the service, since the rules depend on `category`; doing the
 * second check there is what yields `CATEGORY_DATA_INVALID` with the offending
 * field path.
 *
 * The `@ValidateIf(isPresent)` versus `@IsOptional()` split is the database's,
 * not a preference: `locationText`, `price` and `closesAt` are nullable, so
 * `null` is a thing a student can mean and the service stores it; `data`,
 * `currency` and `imageUrls` cannot be null, so one is refused here with the
 * field named instead of reaching the insert as a null.
 */
export class CreateListingDto {
  @IsIn(LISTING_CATEGORIES)
  category!: ListingCategoryName;

  @IsString()
  @Length(6, 140)
  title!: string;

  // 20 characters is the floor that keeps "interested?" style posts out of the
  // categories where the description is the whole product.
  @IsString()
  @Length(20, 4000)
  description!: string;

  @ValidateIf(isPresent)
  @IsObject()
  data: Record<string, unknown> = {};

  // The three nullable columns of the listing row: a `null` here is a value the
  // database can hold, so `@IsOptional()` lets it through to the service.
  @IsOptional()
  @IsString()
  @Length(2, 140)
  locationText?: string | null;

  // An optional asking price in taka; the ceiling is a sanity check, not a rule
  // about what student commerce can cost.
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(10_000_000)
  price?: number | null;

  @ValidateIf(isPresent)
  @IsString()
  @Length(3, 3)
  currency = 'BDT';

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  closesAt?: Date | null;

  // URLs already uploaded through `POST /api/media/upload`; a listing stores
  // references, never bytes.
  @ValidateIf(isPresent)
  @IsArray()
  @ArrayMaxSize(MAX_IMAGES)
  @IsUrl({}, { each: true })
  @IsString({ each: true })
  imageUrls: string[] = [];
}

/**
 * Body of `PATCH /api/listings/:id`: `CreateListingDto` without `category` (a
 * listing never changes category) and with every field optional.
 *
 * None of these carry defaults, because the service distinguishes "absent,
 * leave it alone" from "present, overwrite" and a default would silently
 * rewrite data the owner never touched. `ListingsService.update` likewise
 * rejects an all-absent body with `NO_FIELDS`.
 *
 * A `null` in this body means one of two things, split by the column: on
 * `locationText`, `price` and `closesAt` it clears the field; on `title`,
 * `description`, `data`, `currency` and `imageUrls` the row cannot hold a null,
 * so it is refused as `VALIDATION_FAILED` naming the field rather than reaching
 * the service, where `dto.title.trim()` on a null answered 500. Clearing every
 * picture is `imageUrls: []`, which is a value.
 */
export class UpdateListingDto {
  @ValidateIf(isPresent)
  @IsString()
  @Length(6, 140)
  title?: string;

  @ValidateIf(isPresent)
  @IsString()
  @Length(20, 4000)
  description?: string;

  @ValidateIf(isPresent)
  @IsObject()
  data?: Record<string, unknown>;

  // The three nullable columns, where `null` is an instruction and not a
  // mistake: `@IsOptional()` lets it reach the service, which clears the field.
  @IsOptional()
  @IsString()
  @Length(2, 140)
  locationText?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(10_000_000)
  price?: number | null;

  @ValidateIf(isPresent)
  @IsString()
  @Length(3, 3)
  currency?: string;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  closesAt?: Date | null;

  @ValidateIf(isPresent)
  @IsArray()
  @ArrayMaxSize(MAX_IMAGES)
  @IsUrl({}, { each: true })
  @IsString({ each: true })
  imageUrls?: string[];
}

/**
 * Query string for `GET /api/listings`, the public search. The
 * category-specific filters (`condition`, `level`, `subject`, `purpose`,
 * `reportType`, `transportType`, `intent`, `listingType`, `fromArea`,
 * `toArea`, `day`, `skill`, `roleNeeded`) are matched against the `data`
 * column; `GET /api/listings/facets/:category` returns the values that exist.
 */
export class SearchListingsQueryDto {
  @IsOptional()
  @IsString()
  @Length(0, 120)
  q?: string;

  @IsOptional()
  @IsIn(LISTING_CATEGORIES)
  category?: ListingCategoryName;

  // Closed and hidden listings stay out of public search unless asked for.
  @IsOptional()
  @IsIn(LISTING_WRITE_STATUSES)
  status: ListingWriteStatus = ListingStatus.ACTIVE;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minPrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxPrice?: number;

  @IsOptional()
  @IsString()
  @Length(0, 140)
  location?: string;

  @IsOptional()
  @IsString()
  @Length(0, 20)
  condition?: string;

  @IsOptional()
  @IsString()
  @Length(0, 20)
  level?: string;

  @IsOptional()
  @IsString()
  @Length(0, 60)
  subject?: string;

  @IsOptional()
  @IsString()
  @Length(0, 20)
  purpose?: string;

  @IsOptional()
  @IsString()
  @Length(0, 10)
  reportType?: string;

  @IsOptional()
  @IsString()
  @Length(0, 20)
  transportType?: string;

  @IsOptional()
  @IsString()
  @Length(0, 10)
  intent?: string;

  // Tuition and commute name their side of the post `listingType`, so one filter
  // serves both: tutors looking for students and students looking for a tutor,
  // seats offered and seats wanted.
  @Transform(toStoredCase)
  @IsOptional()
  @IsIn([...LISTING_TYPES])
  listingType?: ListingTypeName;

  // The two ends of a commute route are text the poster typed, so they are
  // matched as text rather than exactly like the enums above.
  @IsOptional()
  @IsString()
  @Length(0, 120)
  fromArea?: string;

  @IsOptional()
  @IsString()
  @Length(0, 120)
  toArea?: string;

  // One weekday of a standing commute, matched against the post's `days` array.
  @Transform(toStoredCase)
  @IsOptional()
  @IsIn([...WEEK_DAYS])
  day?: WeekDayName;

  // What a group-finder post still needs, matched against its two arrays the
  // same exact way `subject` matches a tuition post's.
  @IsOptional()
  @IsString()
  @Length(0, 60)
  skill?: string;

  @IsOptional()
  @IsString()
  @Length(0, 60)
  roleNeeded?: string;

  @IsOptional()
  @IsString()
  ownerId?: string;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  closesBefore?: Date;

  @IsOptional()
  @IsIn(['recent', 'price_asc', 'price_desc', 'oldest'])
  sort: 'recent' | 'price_asc' | 'price_desc' | 'oldest' = 'recent';

  // Search pages are capped at 50 rather than the general 100: a search result
  // carries owner details, so a large page is expensive to build and to render.
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 20;
}

/** `?status=` for `GET /api/listings/mine`, which also shows closed and hidden rows. */
export class MineListingsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  status?: string;
}
