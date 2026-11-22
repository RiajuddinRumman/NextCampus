import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository, type EntityManager } from 'typeorm';
import { Block, Listing, Notification, Profile, User } from '../../database/entities/index';
import { ListingStatus, NotificationType } from '../../database/schema';
import {
  buildPageMeta,
  page,
  toSkipTake,
  type PaginationQueryDto,
} from '../../common/dto/pagination';
import { Errors } from '../../common/errors';
import { hasPatchValues } from '../../common/helpers/has-patch-values';
import { isDuplicateKey } from '../../common/helpers/is-duplicate-key';
import { ImageUrlPolicy } from '../media/image-url-policy';
import type { UpdateProfileDto } from './dto/user.dto';

/**
 * What another student may see about you. Deliberately narrower than the row:
 * no e-mail, no verification flag, no private contact, no password.
 */
type PublicUser = Pick<User, 'id' | 'name' | 'image' | 'role' | 'department' | 'bio' | 'createdAt'>;

function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    name: user.name,
    image: user.image,
    role: user.role,
    department: user.department,
    bio: user.bio,
    createdAt: user.createdAt,
  };
}

@Injectable()
export class UsersService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Profile) private readonly profiles: Repository<Profile>,
    @InjectRepository(Block) private readonly blocks: Repository<Block>,
    @InjectRepository(Listing) private readonly listings: Repository<Listing>,
    @InjectRepository(Notification) private readonly notifications: Repository<Notification>,
    private readonly ownedImages: ImageUrlPolicy,
  ) {}

  async me(userId: string) {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw Errors.userNotFound();
    const profile = await this.profiles.findOne({ where: { userId } });
    const blockedCount = await this.blocks.count({ where: { blockerId: userId } });
    return {
      ...toPublicUser(user),
      email: user.email,
      emailVerified: user.emailVerified,
      status: user.status,
      privateContact: user.privateContact,
      profile,
      blockedCount,
    };
  }

  /**
   * Public view of another student. E-mail addresses and private contact
   * details are never included.
   */
  async publicProfile(userId: string, viewerId: string) {
    if (userId === viewerId) return this.me(userId);
    const target = await this.users.findOne({ where: { id: userId } });
    if (!target) throw Errors.userNotFound();

    const [blockedByViewer, blocksViewer, activeListings, profile] = await Promise.all([
      this.blocks.findOne({
        where: { blockerId: viewerId, blockedId: userId },
        select: { id: true },
      }),
      this.blocks.findOne({
        where: { blockerId: userId, blockedId: viewerId },
        select: { id: true },
      }),
      this.listings.count({ where: { ownerId: userId, status: ListingStatus.ACTIVE } }),
      this.profiles.findOne({ where: { userId } }),
    ]);

    return {
      ...toPublicUser(target),
      profile: profile
        ? { headline: profile.headline, about: profile.about, interests: profile.interests }
        : null,
      activeListings,
      relationships: {
        blockedByViewer: Boolean(blockedByViewer),
        blocksViewer: Boolean(blocksViewer),
      },
    };
  }

  /**
   * One request, two tables: the account row and the profile row. They are
   * written in one transaction so a half-saved profile — the new bio with the
   * old headline — is not something a student can see.
   */
  async updateProfile(userId: string, dto: UpdateProfileDto) {
    if (!hasPatchValues(dto)) {
      throw Errors.noFields(
        'name, bio, department, image, headline, about, interests, privateContact',
      );
    }

    // A `null` clears the picture, which is a value rather than a link to
    // believe; a string has to have come out of this platform's upload route.
    if (typeof dto.image === 'string') this.ownedImages.assertProfileImage(dto.image);

    await this.dataSource.transaction(async (manager) => {
      // `undefined` means "not in this request" and `null` means "clear it", so
      // the patch is built key by key rather than spread — TypeORM would
      // otherwise have no way to tell the two apart. `name` is the odd one: the
      // column is `NOT NULL`, so the DTO already refuses `{"name": null}` and
      // only a string can arrive for it.
      const accountPatch: Partial<
        Pick<User, 'name' | 'department' | 'image' | 'bio' | 'privateContact'>
      > = {};
      for (const key of ['department', 'image', 'bio', 'privateContact'] as const) {
        const value = dto[key];
        if (value !== undefined) accountPatch[key] = value;
      }
      if (dto.name !== undefined) accountPatch.name = dto.name;
      if (Object.keys(accountPatch).length) {
        await manager.update(User, { id: userId }, accountPatch);
      }
      await this.applyProfileDocument(manager, userId, dto);
    });
    return this.me(userId);
  }

  /**
   * The three columns that live on the separate `profiles` row, written as a
   * set: sending `headline` alone leaves `about` and `interests` as they are,
   * and sending all three as `null` clears the document rather than deleting it.
   */
  private async applyProfileDocument(
    manager: EntityManager,
    userId: string,
    dto: UpdateProfileDto,
  ): Promise<void> {
    // Key by key, the same way the account patch above is built: `undefined`
    // means "not in this request" and `null` means "clear it". An object with
    // `?? null` in each slot would answer a student's "update my headline" by
    // deleting the about text they wrote last term.
    const values: Partial<Pick<Profile, 'headline' | 'about' | 'interests'>> = {};
    for (const key of ['headline', 'about', 'interests'] as const) {
      if (dto[key] !== undefined) values[key] = dto[key];
    }
    if (!Object.keys(values).length) return;
    const existing = await manager.findOne(Profile, { where: { userId } });
    if (existing) {
      await manager.update(Profile, { id: existing.id }, values);
    } else {
      await manager.save(manager.create(Profile, { userId, ...values }));
    }
  }

  async blockUser(blockerId: string, targetId: string) {
    if (blockerId === targetId) {
      throw new BadRequestException({ code: 'SELF_BLOCK', message: 'You cannot block yourself' });
    }
    const target = await this.users.findOne({
      where: { id: targetId },
      select: { id: true, name: true },
    });
    if (!target) throw Errors.userNotFound();

    const alreadyBlocked = new ConflictException({
      code: 'ALREADY_BLOCKED',
      message: 'User already blocked',
    });
    if (await this.blocks.findOne({ where: { blockerId, blockedId: targetId } })) {
      throw alreadyBlocked;
    }
    // The read above is not the check; the unique index is. Two clicks of the
    // same button pass it together and the database refuses the second save,
    // which has to be answered as the same 409 the read answers — otherwise the
    // double-click that a button is always liable to produce becomes a 500 in
    // the logs. `create()` is the same race `completeRegistration` handles.
    let block: Block;
    try {
      block = await this.blocks.save(this.blocks.create({ blockerId, blockedId: targetId }));
    } catch (error) {
      if (isDuplicateKey(error)) throw alreadyBlocked;
      throw error;
    }
    await this.notifications.save(
      this.notifications.create({
        userId: blockerId,
        type: NotificationType.SYSTEM,
        title: `Blocked ${target.name}`,
        body: 'You will not see each other in inquiries.',
        link: `/users/${targetId}`,
      }),
    );
    return { blocked: true, since: block.createdAt, user: target };
  }

  async unblockUser(blockerId: string, targetId: string) {
    const result = await this.blocks.delete({ blockerId, blockedId: targetId });
    if (!result.affected) {
      throw new NotFoundException({ code: 'NOT_BLOCKED', message: 'That user is not blocked' });
    }
    return { unblocked: true };
  }

  async listBlocked(blockerId: string, query: PaginationQueryDto) {
    const [blocks, total] = await this.blocks.findAndCount({
      where: { blockerId },
      order: { createdAt: 'DESC' },
      ...toSkipTake(query),
    });
    // The blocked students in one read, then re-attached in the page's order:
    // a query per row would be N requests to answer one page.
    const accounts = await this.users.find({
      where: { id: In(blocks.map((block) => block.blockedId)) },
    });
    const byId = new Map(accounts.map((account) => [account.id, account]));
    // Every id in `blocks` still has an account row: both foreign keys on
    // `blocks` are ON DELETE CASCADE, so deleting a student deletes the rows
    // that pointed at them. `Map.get` cannot know that, hence the `!`.
    return page(
      blocks.map((block) => ({
        since: block.createdAt,
        user: toPublicUser(byId.get(block.blockedId)!),
      })),
      buildPageMeta(query, total),
    );
  }

  /** True when either direction of a block exists between these two students. */
  async areBlocked(aId: string, bId: string): Promise<boolean> {
    // One query, two conditions: an array of `where` objects is OR'd together.
    const count = await this.blocks.count({
      where: [
        { blockerId: aId, blockedId: bId },
        { blockerId: bId, blockedId: aId },
      ],
    });
    return count > 0;
  }
}
