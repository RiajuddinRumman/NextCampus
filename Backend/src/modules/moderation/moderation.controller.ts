import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '../../database/schema';
import { Roles } from '../../common/decorators/auth.decorators';
import type { AuthUser } from '../auth/session.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination';
import { ModerationActionsQueryDto, ModerationReasonDto } from './dto/moderation.dto';
import { ModerationService } from './moderation.service';
import { toStaffActor } from '../../common/helpers/staff';
import { ListingsService } from '../listings/listings.service';

/**
 * Staff tools: hide or restore a listing, warn, suspend or restore an account.
 *
 * Every action here writes a row to the moderation log with the acting staff
 * member and the reason, which is why `reason` is mandatory in the DTO.
 * Suspending and restoring are further narrowed to ADMIN — a moderator can
 * stop content, but only an administrator can take away an account.
 */
@ApiTags('moderation')
@Roles(Role.MODERATOR, Role.ADMIN)
@Controller('moderation')
export class ModerationController {
  constructor(
    private readonly moderation: ModerationService,
    private readonly listings: ListingsService,
  ) {}

  @Post('listings/:id/hide')
  @ApiOperation({ summary: 'Hide a listing and notify its owner' })
  hide(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: ModerationReasonDto) {
    return this.moderation.hideListing(toStaffActor(user), id, body.reason, body.reportId);
  }

  @Post('listings/:id/unhide')
  @ApiOperation({ summary: 'Restore a hidden listing' })
  unhide(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: ModerationReasonDto,
  ) {
    return this.moderation.unhideListing(toStaffActor(user), id, body.reason);
  }

  @Post('users/:id/warn')
  @ApiOperation({ summary: 'Issue a recorded warning to a student' })
  warn(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: ModerationReasonDto) {
    return this.moderation.warnUser(toStaffActor(user), id, body.reason, body.reportId);
  }

  @Post('users/:id/suspend')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Suspend an account (admin only)' })
  suspend(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: ModerationReasonDto,
  ) {
    return this.moderation.suspendUser(toStaffActor(user), id, body.reason, body.reportId);
  }

  @Post('users/:id/restore')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Restore a suspended account (admin only)' })
  restore(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: ModerationReasonDto,
  ) {
    return this.moderation.restoreUser(toStaffActor(user), id, body.reason);
  }

  @Get('hidden-listings')
  @ApiOperation({ summary: 'Listings currently hidden by moderation' })
  hidden(@Query() pagination: PaginationQueryDto) {
    return this.listings.listHidden(pagination);
  }

  @Get('actions')
  @ApiOperation({ summary: 'Record of moderation actions' })
  actions(@Query() query: ModerationActionsQueryDto) {
    return this.moderation.history(query);
  }
}
