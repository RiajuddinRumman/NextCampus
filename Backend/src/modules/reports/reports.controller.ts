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
import { ReportStatus, Role } from '../../database/schema';
import { Roles, VerifiedStudent } from '../../common/decorators/auth.decorators';
import type { AuthUser } from '../auth/session.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination';
import { CreateReportDto, MIN_NOTE_LENGTH, ReportNoteDto, REPORT_STATUSES, ReportQueueQueryDto } from './dto/report.dto';
import { ReportWorklistService } from './report-worklist.service';
import { ReportsService } from './reports.service';

/**
 * Student reports and the staff queue that works through them.
 *
 * A student can file a report and see the outcome of their own; only a
 * moderator or an admin sees the queue, claims a report, or closes it — and
 * closing one always requires a note, because the note is what makes the
 * decision reviewable later.
 *
 * The two services behind this controller split the same way the routes do:
 * `ReportsService` for what a student files and what staff decide, and
 * `ReportWorklistService` for the reading a moderator does before deciding.
 */
@ApiTags('reports')
@Controller('reports')
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly worklist: ReportWorklistService,
  ) {}

  @VerifiedStudent()
  @Post()
  @ApiOperation({ summary: 'Report a student or a listing' })
  file(@CurrentUser() user: AuthUser, @Body() body: CreateReportDto) {
    return this.reports.file(user.id, body);
  }

  @VerifiedStudent()
  @Get('mine')
  @ApiOperation({ summary: 'Reports you have filed and their outcomes' })
  mine(@CurrentUser() user: AuthUser, @Query() pagination: PaginationQueryDto) {
    return this.reports.mine(user.id, pagination);
  }

  @Roles(Role.MODERATOR, Role.ADMIN)
  @Get('queue')
  @ApiQuery({ name: 'status', required: false, enum: REPORT_STATUSES })
  @ApiOperation({ summary: 'Moderation queue (defaults to open and in-review reports)' })
  queue(@Query() query: ReportQueueQueryDto) {
    return this.worklist.queue(query);
  }

  @Roles(Role.MODERATOR, Role.ADMIN)
  @Get('target-history/:userId')
  @ApiOperation({ summary: 'Everything moderators have seen about one student' })
  history(@Param('userId') userId: string) {
    return this.worklist.targetHistory(userId);
  }

  @Roles(Role.MODERATOR, Role.ADMIN)
  @Patch(':id/start-review')
  @ApiOperation({ summary: 'Claim an open report for review' })
  start(@Param('id') id: string) {
    return this.reports.startReview(id);
  }

  @Roles(Role.MODERATOR, Role.ADMIN)
  @Patch(':id/resolve')
  @ApiOperation({ summary: 'Close a report as resolved, with an outcome note' })
  resolve(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: ReportNoteDto,
  ) {
    return this.reports.close(user.id, id, ReportStatus.RESOLVED, this.requiredNote(body));
  }

  @Roles(Role.MODERATOR, Role.ADMIN)
  @Patch(':id/dismiss')
  @ApiOperation({ summary: 'Close a report as dismissed, with an outcome note' })
  dismiss(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: ReportNoteDto,
  ) {
    return this.reports.close(user.id, id, ReportStatus.DISMISSED, this.requiredNote(body));
  }

  /**
   * The floor is the part a validator cannot say.
   *
   * `ReportNoteDto` carries the shape — a string, no longer than the ceiling
   * every other free-text field stops at — and the pipe answers with the field
   * named when that is what is wrong. That closing a report needs a note at all
   * is a rule about the audit trail, not about the field, so it keeps its own
   * code here: `NOTE_REQUIRED` tells a moderator "write a longer note", where a
   * generic validation error would only tell them the body was wrong.
   */
  private requiredNote(body: ReportNoteDto): string {
    const note = body?.note?.trim() ?? '';
    if (note.length < MIN_NOTE_LENGTH) {
      throw new BadRequestException({
        code: 'NOTE_REQUIRED',
        message: `A note of at least ${MIN_NOTE_LENGTH} characters is required to close a report`,
      });
    }
    return note;
  }
}
