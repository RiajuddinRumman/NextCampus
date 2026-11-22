import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '../../database/schema';
import { Roles } from '../../common/decorators/auth.decorators';
import type { AuthUser } from '../auth/session.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  AssignRoleDto,
  CreatePlatformUserDto,
  RemoveUserDto,
  SearchUsersQueryDto,
  VerifyUserDto,
} from './dto/admin.dto';
import { AdminDirectoryService } from './admin-directory.service';
import { AdminService } from './admin.service';
import { toStaffActor } from '../../common/helpers/staff';

/**
 * The administrator's back office: platform counts, account search, accounts
 * added and removed, moderator roles, manual verification, profile corrections.
 *
 * The module is named after the people allowed in, not after roles themselves.
 * `Role` lives on the account and the rule that reads it is `AuthzGuard`; this
 * controller is only the surface that lets an admin change it, which is why every
 * route here is `@Roles(Role.ADMIN)` and lives under `/api/admin/*`.
 *
 * The one thing this surface cannot do is create, change or remove an
 * administrator — those are `users` rows with `role = ADMIN` inserted by hand with
 * SQL, so the role is given away only by that write or by editing the row.
 * `PATCH users/:id/role` reaches USER and MODERATOR; the create and remove routes
 * work within those two roles and refuse a target that already holds ADMIN.
 */
@ApiTags('admin')
@Roles(Role.ADMIN)
@Controller('admin')
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly directory: AdminDirectoryService,
  ) {}

  @Get('overview')
  @ApiOperation({ summary: 'Platform-wide counts for the admin dashboard' })
  overview() {
    return this.directory.overview();
  }

  @Get('users')
  @ApiOperation({ summary: 'Search accounts by name, address, role or status' })
  users(@Query() query: SearchUsersQueryDto) {
    return this.directory.searchUsers(query);
  }

  @Get('users/:id')
  @ApiOperation({ summary: 'Full account view: listings, reports and actions' })
  user(@Param('id') id: string) {
    return this.directory.userDetail(id);
  }

  @Patch('users/:id/role')
  @ApiOperation({ summary: 'Assign or revoke USER or MODERATOR; every change is recorded' })
  role(@CurrentUser() admin: AuthUser, @Param('id') id: string, @Body() body: AssignRoleDto) {
    return this.admin.assignRole(toStaffActor(admin), id, body);
  }

  @Post('users')
  @ApiOperation({ summary: 'Create an account an administrator has vouched for' })
  create(@CurrentUser() admin: AuthUser, @Body() body: CreatePlatformUserDto) {
    return this.admin.createUser(toStaffActor(admin), body);
  }

  @Post('users/:id/remove')
  @ApiOperation({ summary: 'Delete an account that has no content of its own' })
  remove(@CurrentUser() admin: AuthUser, @Param('id') id: string, @Body() body: RemoveUserDto) {
    return this.admin.removeUser(toStaffActor(admin), id, body.reason);
  }

  @Post('users/:id/verify')
  @ApiOperation({ summary: 'Verify an institutional address manually (documented exception)' })
  verify(@CurrentUser() admin: AuthUser, @Param('id') id: string, @Body() body: VerifyUserDto) {
    return this.admin.markEmailVerified(toStaffActor(admin), id, body.reason);
  }

  /**
   * Deliberately the one route here without a body DTO. Of the two keys it reads
   * (`name`, `department`) none is required, so there is no shape to validate —
   * only that at least one is present, the service's `NO_FIELDS`. A DTO with
   * `forbidNonWhitelisted` would turn a stray `privateContact` into
   * `VALIDATION_FAILED` and erase that distinction. The values are still
   * type-checked and measured in `AdminService.correctProfile()`, against the
   * same ceilings `UpdateProfileDto` declares, so neither a non-string nor an
   * over-long name can reach the database.
   */
  @Patch('users/:id/profile')
  @ApiOperation({ summary: 'Correct account data a student cannot change themselves' })
  profile(
    @CurrentUser() admin: AuthUser,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.admin.correctProfile(toStaffActor(admin), id, body ?? {});
  }
}
