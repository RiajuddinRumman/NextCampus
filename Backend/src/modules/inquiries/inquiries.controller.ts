import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { InquiryStatus } from '../../database/schema';
import { VerifiedStudent } from '../../common/decorators/auth.decorators';
import type { AuthUser } from '../auth/session.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CreateInquiryDto, InquiriesListQueryDto, RespondInquiryDto } from './dto/inquiry.dto';
import { InquiriesService } from './inquiries.service';

// The four values `InquiryStatus` can hold, in the order they are declared —
// read from the enum rather than listed again, so a new status cannot be left
// out of the `?status=` filter this route accepts.
const INQUIRY_STATUSES = Object.values(InquiryStatus);

/**
 * Reads the `status` filter out of the query string.
 *
 * The check lives here, in words, instead of in a validation decorator because
 * the answer is expected to be `BAD_STATUS` — a client that sends a typo gets
 * the same response as before, not a generic validation failure.
 */
function parseStatus(value?: string): InquiryStatus | 'ALL' {
  const normalized = (value ?? 'ALL').toUpperCase();
  if (normalized === 'ALL') return 'ALL';
  if (!(INQUIRY_STATUSES as readonly string[]).includes(normalized)) {
    throw new BadRequestException({
      code: 'BAD_STATUS',
      message: `status must be ALL or one of ${INQUIRY_STATUSES.join(', ')}`,
    });
  }
  return normalized as InquiryStatus;
}

/**
 * The contact channel between two students.
 *
 * There is no chat here on purpose: a student sends an inquiry, the owner
 * accepts or declines, and only then may the owner choose to share a private
 * contact detail. Everything is a recorded message, not a live conversation.
 */
@ApiTags('inquiries')
@VerifiedStudent()
@Controller('inquiries')
export class InquiriesController {
  constructor(private readonly inquiries: InquiriesService) {}

  @Post()
  @ApiOperation({ summary: 'Submit an inquiry on an active listing' })
  submit(@CurrentUser() user: AuthUser, @Body() body: CreateInquiryDto) {
    return this.inquiries.submit(user.id, body);
  }

  @Get('sent')
  @ApiQuery({ name: 'status', required: false, enum: ['ALL', ...INQUIRY_STATUSES] })
  @ApiOperation({ summary: 'Inquiries you submitted' })
  sent(@CurrentUser() user: AuthUser, @Query() query: InquiriesListQueryDto) {
    return this.inquiries.list(user.id, 'sent', parseStatus(query.status), query);
  }

  @Get('received')
  @ApiQuery({ name: 'status', required: false, enum: ['ALL', ...INQUIRY_STATUSES] })
  @ApiOperation({ summary: 'Inquiries other students sent to your listings' })
  received(@CurrentUser() user: AuthUser, @Query() query: InquiriesListQueryDto) {
    return this.inquiries.list(user.id, 'received', parseStatus(query.status), query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Inquiry detail for either participant' })
  detail(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.inquiries.detail(user.id, id);
  }

  @Patch(':id/accept')
  @ApiOperation({ summary: 'Accept an inquiry, optionally sharing a contact detail' })
  accept(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: RespondInquiryDto) {
    return this.inquiries.respond(user.id, id, InquiryStatus.ACCEPTED, body);
  }

  @Patch(':id/decline')
  @ApiOperation({ summary: 'Decline an inquiry' })
  decline(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: RespondInquiryDto) {
    return this.inquiries.respond(user.id, id, InquiryStatus.DECLINED, body);
  }

  @Patch(':id/cancel')
  @ApiOperation({ summary: 'Cancel an inquiry you sent' })
  cancel(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.inquiries.cancel(user.id, id);
  }

  @Patch(':id/message')
  @ApiOperation({ summary: 'Add a follow-up reply to an accepted inquiry' })
  message(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: RespondInquiryDto) {
    return this.inquiries.messageInquirer(user.id, id, body);
  }
}
