import { plainToInstance, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDate,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';
import { describeValidationErrors } from '../../common/validators/validation-errors';
import type { ListingCategoryName } from './dto/listing.dto';

/**
 * Category payloads: what each category may put inside a listing's `data`
 * JSONB column. They are validated here rather than only by the global body
 * pipe, because the rules depend on the listing's category — a sibling field,
 * not the shape of the field being checked.
 *
 * Whatever survives is stored, defaults included, so a reader of the row never
 * has to guess whether an absent `negotiable` meant false or meant unknown.
 */

export const ITEM_CONDITIONS = ['NEW', 'LIKE_NEW', 'GOOD', 'FAIR', 'POOR'] as const;
/**
 * The side of a post, named the same way by the two categories that have one:
 * tuition and commute. Search filters it with `?listingType=`, which is why it
 * is a constant rather than two copies of the same `@IsIn` list.
 */
export const LISTING_TYPES = ['OFFER', 'REQUEST'] as const;
export const TUITION_LEVELS = [
  'SCHOOL',
  'HSC',
  'DIPLOMA',
  'UNDERGRADUATE',
  'POSTGRADUATE',
] as const;
export const TRANSPORT_TYPES = [
  'BUS',
  'CNG',
  'RICKSHAW',
  'CARPOOL',
  'BIKE',
  'WALKING',
  'TRAIN',
] as const;
export const WEEK_DAYS = ['SAT', 'SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI'] as const;

/** Marketplace: buying, selling or renting something between students. */
export class MarketplaceDataDto {
  @IsIn(['SELL', 'BUY', 'RENT'])
  intent!: 'SELL' | 'BUY' | 'RENT';

  @IsIn([...ITEM_CONDITIONS])
  condition!: (typeof ITEM_CONDITIONS)[number];

  @IsOptional()
  @IsBoolean()
  negotiable = false;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  rentDuration?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  warranty?: string | null;
}

/** Tuition: offering or asking for teaching in specific subjects. */
export class TuitionDataDto {
  @IsIn([...LISTING_TYPES])
  listingType!: (typeof LISTING_TYPES)[number];

  // At least one subject, otherwise the listing cannot be matched to a student.
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(12)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(60, { each: true })
  subjects!: string[];

  @IsIn([...TUITION_LEVELS])
  level!: (typeof TUITION_LEVELS)[number];

  @IsOptional()
  @IsString()
  @MaxLength(60)
  curriculum?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  board?: string | null;

  @IsOptional()
  @IsIn(['ONLINE', 'IN_PERSON', 'HYBRID'])
  preferredMode: 'ONLINE' | 'IN_PERSON' | 'HYBRID' = 'IN_PERSON';

  @IsOptional()
  @IsString()
  @MaxLength(160)
  schedule?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  expectedMonthlyFee?: number;
}

/** Group finder: assembling a team for a project, competition or club. */
export class GroupFinderDataDto {
  @IsIn(['PROJECT', 'THESIS', 'RESEARCH', 'HACKATHON', 'COMPETITION', 'SPORTS', 'CLUB', 'OTHER'])
  purpose!:
    'PROJECT' | 'THESIS' | 'RESEARCH' | 'HACKATHON' | 'COMPETITION' | 'SPORTS' | 'CLUB' | 'OTHER';

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  activity!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(15)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  requiredSkills: string[] = [];

  // A team of one is not a group, and 50 is a practical ceiling for a student project.
  @Type(() => Number)
  @IsInt()
  @Min(2)
  @Max(50)
  teamSize!: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(15)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  rolesNeeded: string[] = [];

  @IsOptional()
  @IsIn(['ONLINE', 'IN_PERSON', 'HYBRID'])
  collaborationMode: 'ONLINE' | 'IN_PERSON' | 'HYBRID' = 'HYBRID';

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  deadline?: Date;
}

/** Lost and found: one report per item, closed by the owner when resolved. */
export class LostFoundDataDto {
  @IsIn(['LOST', 'FOUND'])
  reportType!: 'LOST' | 'FOUND';

  @IsOptional()
  @IsBoolean()
  resolved = false;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  brand?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  colour?: string;

  @IsOptional()
  @IsString()
  @MaxLength(400)
  distinctiveMarks?: string;
}

/** Commute: sharing a route and splitting the fare. */
export class CommuteDataDto {
  @IsIn([...LISTING_TYPES])
  listingType!: (typeof LISTING_TYPES)[number];

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  fromArea!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  toArea!: string;

  // Stored as text because it is a standing time, not a moment on a calendar.
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'Use 24-hour HH:mm' })
  departureTime!: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsIn([...WEEK_DAYS], { each: true })
  days!: (typeof WEEK_DAYS)[number][];

  @IsIn([...TRANSPORT_TYPES])
  transportType!: (typeof TRANSPORT_TYPES)[number];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(20)
  availableSeats?: number;

  @IsOptional()
  @IsBoolean()
  splitCost = true;
}

/**
 * The category-to-shape map, and the single source of truth for which
 * categories exist: a listing can only be validated against the DTO its own
 * category names, so an unknown category fails here instead of silently
 * storing an unvalidated payload.
 */
export const CATEGORY_DATA_DTOS = {
  MARKETPLACE: MarketplaceDataDto,
  TUITION: TuitionDataDto,
  GROUP_FINDER: GroupFinderDataDto,
  LOST_FOUND: LostFoundDataDto,
  COMMUTE: CommuteDataDto,
} as const satisfies Record<ListingCategoryName, new () => object>;

export type CategoryDataResult =
  | { ok: true; data: Record<string, unknown> }
  | {
      ok: false;
      message: string;
      /** Field-level failures in the same shape the request pipe reports. */
      details?: { path: string; message: string }[];
    };

/**
 * Validates one listing's category payload. Returns a result rather than
 * throwing so the caller picks the status and code (`CATEGORY_DATA_INVALID`);
 * create and update share it, with the category coming from the stored row on
 * update.
 */
export function validateCategoryData(category: string, payload: unknown): CategoryDataResult {
  const dtoClass = (CATEGORY_DATA_DTOS as Record<string, new () => object>)[category];
  if (!dtoClass) {
    return { ok: false, message: `Unknown category: ${category}` };
  }

  // An explicit `"negotiable": undefined` means "not provided", exactly like a
  // missing key; dropping those first keeps the class defaults.
  const provided = Object.fromEntries(
    Object.entries(payload ?? {}).filter(([, value]) => value !== undefined),
  );

  const instance = plainToInstance(dtoClass, provided);
  // A category payload never reaches the global pipe (it is one field inside a
  // body), so the same two options the pipe uses are applied here by hand.
  const errors = validateSync(instance, { whitelist: true, forbidNonWhitelisted: true });

  if (errors.length) {
    return {
      ok: false,
      message: `Invalid ${category} details`,
      details: describeValidationErrors(errors),
    };
  }

  // Only the declared fields are persisted, so nothing extra can ride along.
  return {
    ok: true,
    data: Object.fromEntries(
      Object.entries(instance as Record<string, unknown>).filter(
        ([, value]) => value !== undefined,
      ),
    ),
  };
}
