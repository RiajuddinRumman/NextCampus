import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { VerifiedStudent } from '../../common/decorators/auth.decorators';
import type { AuthUser } from '../auth/session.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination';
import { UpdateProfileDto } from './dto/user.dto';
import { UsersService } from './users.service';

/**
 * A student's own account: profile, private contact setting and block list.
 *
 * Reading another student goes through `GET /api/users/:userId`, which returns
 * the public view only. Anything a student could use to change their standing —
 * role, verification state, e-mail address — is absent from these DTOs, so
 * those fields cannot be set through this controller at all.
 */
@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  @ApiOperation({ summary: 'Own profile including the private contact setting' })
  me(@CurrentUser() user: AuthUser) {
    return this.users.me(user.id);
  }

  @Patch('me')
  @ApiOperation({ summary: 'Update own profile; only listed fields change' })
  updateMe(@CurrentUser() user: AuthUser, @Body() body: UpdateProfileDto) {
    return this.users.updateProfile(user.id, body);
  }

  @VerifiedStudent()
  @Get('me/blocks')
  @ApiOperation({ summary: 'Students you have blocked' })
  listBlocks(@CurrentUser() user: AuthUser, @Query() query: PaginationQueryDto) {
    return this.users.listBlocked(user.id, query);
  }

  @VerifiedStudent()
  @Get(':userId')
  @ApiOperation({ summary: 'Public profile of a student' })
  profile(@CurrentUser() user: AuthUser, @Param('userId') userId: string) {
    return this.users.publicProfile(userId, user.id);
  }

  @VerifiedStudent()
  @Post(':userId/block')
  @ApiOperation({ summary: 'Block a student' })
  block(@CurrentUser() user: AuthUser, @Param('userId') userId: string) {
    return this.users.blockUser(user.id, userId);
  }

  @VerifiedStudent()
  @Delete(':userId/block')
  @ApiOperation({ summary: 'Unblock a student' })
  unblock(@CurrentUser() user: AuthUser, @Param('userId') userId: string) {
    return this.users.unblockUser(user.id, userId);
  }
}
