import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { Notification } from '../../database/entities/index';
import { NotificationType } from '../../database/schema';
import { Errors } from '../../common/errors';
import {
  buildPageMeta,
  page,
  toSkipTake,
  type PaginationQueryDto,
} from '../../common/dto/pagination';

export interface NotifyInput {
  userId: string;
  type: NotificationType;
  title: string;
  body?: string;
  link?: string;
}

/**
 * The inbox. Nothing in it is delivered live: a student reads it by asking for
 * it, which is why a row is written as soon as something happens rather than
 * when somebody is looking.
 */
@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(Notification)
    private readonly notifications: Repository<Notification>,
  ) {}

  async notify(input: NotifyInput) {
    return this.notifications.save(
      this.notifications.create({
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body ?? null,
        link: input.link ?? null,
      }),
    );
  }

  /** One event that concerns many students (a report being closed, say). */
  async notifyMany(userIds: string[], input: Omit<NotifyInput, 'userId'>) {
    const unique = [...new Set(userIds)];
    if (!unique.length) return { count: 0 };
    await this.notifications.save(
      this.notifications.create(
        unique.map((userId) => ({
          userId,
          type: input.type,
          title: input.title,
          body: input.body ?? null,
          link: input.link ?? null,
        })),
      ),
    );
    return { count: unique.length };
  }

  async list(userId: string, query: PaginationQueryDto, unreadOnly = false) {
    const where = {
      userId,
      ...(unreadOnly ? { readAt: IsNull() } : {}),
    };
    const [items, total] = await this.notifications.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      ...toSkipTake(query),
    });
    return page(items, buildPageMeta(query, total));
  }

  async unreadCount(userId: string) {
    return this.notifications.count({ where: { userId, readAt: IsNull() } });
  }

  async markRead(userId: string, id: string) {
    const notification = await this.notifications.findOne({ where: { id } });
    if (!notification) throw Errors.notificationNotFound();
    if (notification.userId !== userId) {
      throw new ForbiddenException({ code: 'NOT_OWNED', message: 'Not your notification' });
    }
    // Reading an already-read row again leaves its timestamp where it was, so
    // the badge does not move backwards.
    notification.readAt ??= new Date();
    return this.notifications.save(notification);
  }

  async markAllRead(userId: string) {
    const result = await this.notifications.update(
      { userId, readAt: IsNull() },
      { readAt: new Date() },
    );
    return { updated: result.affected ?? 0 };
  }

  async remove(userId: string, id: string) {
    const result = await this.notifications.delete({ id, userId });
    if (!result.affected) throw Errors.notificationNotFound();
    return { deleted: true };
  }
}
