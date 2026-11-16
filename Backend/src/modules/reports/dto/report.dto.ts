import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination';
import { isPresent } from '../../../common/validators/is-present';
import { ReportStatus, ReportTargetType } from '../../../database/schema';

/**
 * Read from `ReportTargetType` rather than listed again: the `reports` table
 * has a real enum column with those two names, and a third target added there
 * has to be added once. `Object.values` keeps the declaration order, so the
 * list `@IsIn` names in its failure message is unchanged.
 */
export const REPORT_TARGET_TYPES = Object.values(ReportTargetType);

/** The four `?status=` values the staff queue accepts, in column order. */
export const REPORT_STATUSES = Object.values(ReportStatus);

export const REPORT_CATEGORIES = [
  'SPAM',
  'SCAM',
  'HARASSMENT',
  'INAPPROPRIATE_CONTENT',
  'FAKE_LISTING',
  'OTHER',
] as const;
export type ReportCategory = (typeof REPORT_CATEGORIES)[number];

/**
 * Whether the body names exactly the one target its `targetType` promises.
 *
 * A report points at one thing: either a student or a listing. Which id is
 * required depends on `targetType`, and sending both is rejected — a report about
 * two subjects could not be assigned to a moderator. The per-field validators
 * below cannot see across fields, so `ReportsService.file` calls this once per
 * request instead and answers `REPORT_TARGET_MISMATCH`.
 */
export function targetMatchesType(dto: CreateReportDto): boolean {
  const hasUser = Boolean(dto.targetUserId);
  const hasListing = Boolean(dto.targetListingId);
  return dto.targetType === ReportTargetType.USER ? hasUser && !hasListing : hasListing && !hasUser;
}

/** Body of `POST /api/reports`. */
export class CreateReportDto {
  @IsIn(REPORT_TARGET_TYPES)
  targetType!: ReportTargetType;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  targetUserId?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  targetListingId?: string;

  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  reason!: string;

  // Absent means `OTHER`; `null` has no column to be stored in, so it is refused
  // with the field named rather than reaching the insert.
  @ValidateIf(isPresent)
  @IsIn(REPORT_CATEGORIES)
  category: ReportCategory = 'OTHER';
}

/**
 * The two ends of a closing note, and they are one rule: a note has to be long
 * enough to review later and short enough to be read. The upper bound is the
 * number every other free-text field on this platform already stops at
 * (`reason` on a report, `about` on a profile, the moderation `note`), and it is
 * the one that matters, because the note is written into three places per
 * request — `reports.resolutionNote`, the `moderation_actions` row and the
 * notification the reporting student receives — and read back on every queue
 * page that follows.
 */
export const MIN_NOTE_LENGTH = 5;
export const MAX_NOTE_LENGTH = 2000;

/**
 * Body of the two closing routes, `PATCH /api/reports/:id/resolve` and
 * `/dismiss`.
 *
 * Only the shape the pipe can check lives here: that a note is a string and no
 * longer than the ceiling. That a closing note is *required* at all is a decision
 * about the audit trail rather than about the field, so it stays in
 * `ReportsController` with the `NOTE_REQUIRED` code that tells a moderator which
 * field to fix.
 */
export class ReportNoteDto {
  @IsOptional()
  @IsString()
  @MaxLength(MAX_NOTE_LENGTH)
  note?: string;
}

/**
 * `?status=&targetType=` filters for the moderator queue, plus paging.
 *
 * Both stay plain strings on purpose. A queue filter is typed by hand in the
 * address bar, so a lowercase `open` is a thing a moderator types, and the
 * service uppercases it before checking. Declaring these as the enum instead
 * would let the validation pipe refuse the request first, which answers
 * `VALIDATION_FAILED` where clients already branch on `BAD_STATUS` and
 * `BAD_TARGET_TYPE`.
 */
export class ReportQueueQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  targetType?: string;
}
