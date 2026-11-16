import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, In, Repository, type FindOptionsWhere, type ObjectLiteral } from 'typeorm';
import {
  Block,
  Inquiry,
  Listing,
  ModerationAction,
  Report,
  User,
} from '../../database/entities/index';
import { AccountStatus, ListingStatus, ReportStatus, Role } from '../../database/schema';
import { buildPageMeta, page, toSkipTake } from '../../common/dto/pagination';
import { Errors } from '../../common/errors';
import { likePattern } from '../../common/helpers/like-pattern';
import { toAdminRow, type SearchUsersQueryDto } from './dto/admin.dto';

/**
 * The read side of the back office: the directory, one account in full, and the
 * numbers on the landing screen.
 *
 * Nothing here writes, which is the reason it is a separate service from the one
 * that assigns a role or removes an account. Every route in this half is a
 * question an administrator asks before deciding — and because it is only a
 * question, it needs no transaction, no audit row and no reason string, which is
 * most of what the other service exists to enforce.
 */
@Injectable()
export class AdminDirectoryService {
  constructor(
    @InjectRepository(User)
    private readonly accounts: Repository<User>,
    @InjectRepository(Listing)
    private readonly listings: Repository<Listing>,
    @InjectRepository(Inquiry)
    private readonly inquiries: Repository<Inquiry>,
    @InjectRepository(Report)
    private readonly reports: Repository<Report>,
    @InjectRepository(Block)
    private readonly blocks: Repository<Block>,
    @InjectRepository(ModerationAction)
    private readonly actions: Repository<ModerationAction>,
  ) {}

  /**
   * The admin directory: filter by role, status, or verification, or search
   * free text over name and e-mail - newest first, each row carrying the three
   * counts an admin actually scans.
   */
  async searchUsers(query: SearchUsersQueryDto) {
    const filters: FindOptionsWhere<User> = {};
    if (query.role) filters.role = query.role;
    if (query.status) filters.status = query.status;
    if (query.verified !== undefined) filters.emailVerified = query.verified === 'true';

    // A search term may live in either of two columns. TypeORM reads an array of
    // conditions as OR, so each possibility is its own condition and carries the
    // filters above unchanged.
    const where: FindOptionsWhere<User> | FindOptionsWhere<User>[] = query.q
      ? [
          { ...filters, name: ILike(likePattern(query.q)) },
          { ...filters, email: ILike(likePattern(query.q)) },
        ]
      : filters;

    const [rows, total] = await this.accounts.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      ...toSkipTake(query),
    });

    // Three grouped counts for the whole page instead of three queries per
    // student. The key stays `_count` because that is the shape the admin
    // client already reads.
    const ids = rows.map((row) => row.id);
    const [listingCounts, inquiryCounts, reportCounts] = await Promise.all([
      this.countGrouped(this.listings, 'ownerId', ids),
      this.countGrouped(this.inquiries, 'inquirerId', ids),
      this.countGrouped(this.reports, 'reporterId', ids),
    ]);

    const items = rows.map((row) => ({
      ...toAdminRow(row),
      _count: {
        listings: listingCounts.get(row.id) ?? 0,
        inquiriesSent: inquiryCounts.get(row.id) ?? 0,
        reportsFiled: reportCounts.get(row.id) ?? 0,
      },
    }));
    return page(items, buildPageMeta(query, total));
  }

  /** One student in full: their posts, the complaints against them, what was done. */
  async userDetail(userId: string) {
    const user = await this.accounts.findOne({ where: { id: userId } });
    if (!user) throw Errors.userNotFound();

    const [listings, reportsAgainst, actions, inquiriesReceived, blockedByUsers] =
      await Promise.all([
        this.listings.find({
          where: { ownerId: userId },
          order: { createdAt: 'DESC' },
          take: 25,
          select: { id: true, title: true, category: true, status: true, createdAt: true },
        }),
        this.reports.find({
          where: { targetUserId: userId },
          order: { createdAt: 'DESC' },
          take: 25,
          select: { id: true, targetType: true, category: true, status: true, createdAt: true },
        }),
        this.actions.find({
          where: { targetUserId: userId },
          order: { createdAt: 'DESC' },
          take: 25,
          select: { id: true, action: true, reason: true, createdAt: true },
        }),
        this.inquiries.count({ where: { ownerId: userId } }),
        // How many students have had to block this one: the number that turns a
        // single complaint into a pattern.
        this.blocks.count({ where: { blockedId: userId } }),
      ]);

    return {
      ...toAdminRow(user),
      bio: user.bio,
      image: user.image,
      updatedAt: user.updatedAt,
      listings,
      reportsAgainst,
      moderationActions: actions,
      inquiriesReceived,
      blockedByUsers,
    };
  }

  /** The numbers on the admin landing screen. Counts only, never rows. */
  async overview() {
    const [
      users,
      verifiedUsers,
      moderators,
      admins,
      suspended,
      listings,
      activeListings,
      inquiries,
      openReports,
    ] = await Promise.all([
      this.accounts.count(),
      this.accounts.count({ where: { emailVerified: true } }),
      this.accounts.count({ where: { role: Role.MODERATOR } }),
      this.accounts.count({ where: { role: Role.ADMIN } }),
      this.accounts.count({ where: { status: AccountStatus.SUSPENDED } }),
      this.listings.count(),
      this.listings.count({ where: { status: ListingStatus.ACTIVE } }),
      this.inquiries.count(),
      // A complaint is open for as long as nobody has written a decision, so
      // both of the first two statuses still need reading.
      this.reports.count({ where: { status: In([ReportStatus.OPEN, ReportStatus.UNDER_REVIEW]) } }),
    ]);

    const perCategory = await this.listings
      .createQueryBuilder('listing')
      .select('listing.category', 'category')
      .addSelect('COUNT(*)', 'count')
      .where('listing.status = :status', { status: ListingStatus.ACTIVE })
      .groupBy('listing.category')
      .getRawMany<{ category: string; count: string }>();

    return {
      users: { total: users, verified: verifiedUsers, moderators, admins, suspended },
      listings: {
        total: listings,
        active: activeListings,
        perCategory: Object.fromEntries(
          perCategory.map((row) => [row.category, Number(row.count)]),
        ),
      },
      inquiries: { total: inquiries },
      reports: { open: openReports },
    };
  }

  /**
   * `SELECT key, COUNT(*) ... GROUP BY key` for one column, as a lookup table.
   * Ids are filtered out when the page is empty so the query never becomes
   * `IN ()`, which Postgres rejects.
   */
  private async countGrouped<Entity extends ObjectLiteral>(
    repository: Repository<Entity>,
    column: keyof Entity & string,
    ids: string[],
  ): Promise<Map<string, number>> {
    if (!ids.length) return new Map();
    const rows = await repository
      .createQueryBuilder('row')
      .select(`row.${column}`, 'key')
      .addSelect('COUNT(*)', 'count')
      .where(`row.${column} IN (:...ids)`, { ids })
      .groupBy(`row.${column}`)
      .getRawMany<{ key: string; count: string }>();
    return new Map(rows.map((row) => [row.key, Number(row.count)]));
  }
}
