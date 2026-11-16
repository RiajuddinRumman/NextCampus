import { IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination';

/**
 * Body of `POST /api/inquiries`.
 *
 * There is no chat table on purpose: a message travels to the owner as an
 * inquiry, and the conversation stays on whatever channel the two students
 * agree on after one is accepted.
 */
export class CreateInquiryDto {
  @IsString()
  @IsNotEmpty()
  listingId!: string;

  // A ten-character floor keeps "hi" style spam out of the owner's queue.
  @IsString()
  @MinLength(10)
  @MaxLength(1500)
  message!: string;
}

/**
 * Body of `PATCH /api/inquiries/:id/accept`, `/decline` and `/message`.
 *
 * `sharedContact` is only meaningful on accept: it is the owner volunteering a
 * phone number or handle, and it is the one place a private contact is allowed
 * to leave the account it belongs to.
 */
export class RespondInquiryDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(1500)
  response?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  sharedContact?: string;
}

/**
 * `?status=` for `GET /api/inquiries/sent` and `/received`, plus paging.
 *
 * The value is checked in the controller rather than here so that an unusable
 * status keeps answering `BAD_STATUS`, the code clients already understand.
 */
export class InquiriesListQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  status?: string;
}
