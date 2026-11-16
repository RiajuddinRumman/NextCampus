import { IsIn, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination';

/**
 * `GET /api/notifications` query: the usual page pair plus an unread filter.
 *
 * `unreadOnly` is `true`/`false` text rather than a real boolean because a
 * query string cannot carry types; `?unreadOnly=1` is therefore rejected
 * instead of being silently read as false.
 */
export class NotificationListQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(['true', 'false'])
  unreadOnly?: 'true' | 'false';
}
