import { IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination';

/**
 * Every staff action on a student or a listing must say why, in at least a
 * sentence. The reason is stored on the moderation action row, so this is the
 * audit trail rather than a formality.
 */
export const MIN_REASON_LENGTH = 5;

/** Shared body for hide, unhide, warn, suspend and restore. */
export class ModerationReasonDto {
  @IsString()
  @MinLength(MIN_REASON_LENGTH)
  @MaxLength(2000)
  reason!: string;

  /** Links the action to the report that prompted it, when there was one. */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  reportId?: string;
}

/**
 * `GET /api/moderation/actions`: the usual page pair plus two optional filters.
 *
 * Any query parameter a route accepts has to appear in its DTO, because the
 * validation pipe rejects unknown keys instead of ignoring them.
 */
export class ModerationActionsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  moderatorId?: string;

  @IsOptional()
  @IsString()
  action?: string;
}
