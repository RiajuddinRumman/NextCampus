import { Controller, Delete, Get, Param, Patch, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../auth/session.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { NotificationListQueryDto } from './dto/notification.dto';
import { NotificationsService } from './notifications.service';

/**
 * The in-app bell.
 *
 * Notifications are created by the services that do the thing — an inquiry
 * arriving, an inquiry being answered, an account being suspended — and are
 * only ever read or dismissed here. Nothing in this controller can mark
 * someone else's notification as read.
 */
@ApiTags('notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'In-app notifications, newest first' })
  list(@CurrentUser() user: AuthUser, @Query() query: NotificationListQueryDto) {
    return this.notifications.list(user.id, query, query.unreadOnly === 'true');
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Number of unread notifications' })
  async unread(@CurrentUser() user: AuthUser) {
    return { unread: await this.notifications.unreadCount(user.id) };
  }

  // Declared before ":id/read" so the literal segment is not swallowed by the param route.
  @Patch('read-all')
  @ApiOperation({ summary: 'Mark every notification as read' })
  markAllRead(@CurrentUser() user: AuthUser) {
    return this.notifications.markAllRead(user.id);
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark one notification as read' })
  markRead(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.notifications.markRead(user.id, id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Dismiss a notification' })
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.notifications.remove(user.id, id);
  }
}
