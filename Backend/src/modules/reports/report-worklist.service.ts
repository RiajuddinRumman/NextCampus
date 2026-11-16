import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import type { FindOptionsWhere } from 'typeorm';
import { Block, Listing, ModerationAction, Report, User } from '../../database/entities/index';
import { ModerationActionType, ReportStatus, ReportTargetType } from '../../database/schema';
import { buildPageMeta, page, toSkipTake } from '../../common/dto/pagination';
import { REPORT_STATUSES, REPORT_TARGET_TYPES, type ReportQueueQueryDto } from './dto/report.dto';
import { OPEN_STATUSES } from './entities/report.entity';

/** How much of a report's past the worklist shows beside each row. */
const HISTORY_PER_REPORT = 10;

/** What the queue shows of one staff action: who decided, what, why and when. */
interface ReportHistoryEntry {
  id: string;
  action: ModerationActionType;
  reason: string;
  moderatorId: string;
  createdAt: Date;
}

function toHistoryEntry(action: ModerationAction): ReportHistoryEntry {
  return {
    id: action.id,
    action: action.action,
    reason: action.reason,
    moderatorId: action.moderatorId,
    createdAt: action.createdAt,
  };
}

/** The person or listing a report points at, trimmed to what the queue shows. */
interface LoadedReport {
  reporter: { id: string; name: string } | null;
  targetUser: {
    id: string;
    name: string;
    status: User['status'];
  } | null;
  targetListing: {
    id: string;
    title: string;
    category: Listing['category'];
    status: Listing['status'];
    ownerId: string;
  } | null;
}

/**
 * The read side of the staff queue: what a moderator is shown before deciding.
 *
 * Nothing here writes, which is the reason it is a separate service from the
 * one that files and closes a report. `ReportsService` answers the student; this
 * one answers the person reviewing, and its job is to put enough beside a row
 * that the decision can be made on the page it arrives at rather than across
 * five screens — who reported it, what it points at, what has already been done
 * about it, and how often this target has been reported before.
 */
@Injectable()
export class ReportWorklistService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Report)
    private readonly reports: Repository<Report>,
    @InjectRepository(User)
    private readonly accounts: Repository<User>,
    @InjectRepository(Listing)
    private readonly listings: Repository<Listing>,
    @InjectRepository(ModerationAction)
    private readonly actions: Repository<ModerationAction>,
  ) {}

  /**
   * The staff worklist: oldest open report first, with enough beside each row
   * that a decision can be made here rather than across five screens.
   */
  async queue(query: ReportQueueQueryDto) {
    const [rows, total] = await this.reports.findAndCount({
      where: this.queueFilter(query),
      order: { createdAt: 'ASC' },
      ...toSkipTake(query),
    });
    return page(await this.enrich(rows), buildPageMeta(query, total));
  }

  /** Everything staff know about one student, gathered for a decision. */
  async targetHistory(targetUserId: string) {
    // A report about a student's listing is a report about the student, so each
    // query reaches through the listing as well as matching the row that names
    // them directly.
    const reports = await this.reports
      .createQueryBuilder('report')
      .leftJoin(Listing, 'listing', 'listing.id = report.targetListingId')
      .where('report.targetUserId = :userId', { userId: targetUserId })
      .orWhere('listing.ownerId = :userId', { userId: targetUserId })
      .orderBy('report.createdAt', 'DESC')
      .take(50)
      .getMany();

    const actions = await this.actions
      .createQueryBuilder('action')
      .leftJoin(Report, 'report', 'report.id = action.reportId')
      .where('action.targetUserId = :userId', { userId: targetUserId })
      .orWhere('report.targetUserId = :userId', { userId: targetUserId })
      .orderBy('action.createdAt', 'DESC')
      .take(50)
      .getMany();

    const blockedByUsers = await this.dataSource
      .getRepository(Block)
      .count({ where: { blockedId: targetUserId } });

    return {
      reports: reports.map((report) => ({
        id: report.id,
        targetType: report.targetType,
        category: report.category,
        reason: report.reason,
        status: report.status,
        createdAt: report.createdAt,
      })),
      actions,
      blockedByUsers,
    };
  }

  /**
   * Which rows the worklist shows. Both filters arrive as free text typed into
   * an address bar, so they are upper-cased and checked here rather than by the
   * validation pipe: a typo answers `BAD_STATUS`, the code clients already
   * branch on, and not a generic validation failure.
   */
  private queueFilter(query: ReportQueueQueryDto): FindOptionsWhere<Report> {
    const where: FindOptionsWhere<Report> = {};
    if (query.status) {
      const status = query.status.toUpperCase() as ReportStatus;
      if (!REPORT_STATUSES.includes(status)) {
        throw new BadRequestException({
          code: 'BAD_STATUS',
          message: `status must be one of ${REPORT_STATUSES.join(', ')}`,
        });
      }
      where.status = status;
    } else {
      where.status = In(OPEN_STATUSES);
    }
    if (query.targetType) {
      const type = query.targetType.toUpperCase() as ReportTargetType;
      if (!REPORT_TARGET_TYPES.includes(type)) {
        throw new BadRequestException({
          code: 'BAD_TARGET_TYPE',
          message: 'targetType must be USER or LISTING',
        });
      }
      where.targetType = type;
    }
    return where;
  }

  /**
   * The page of rows with everything beside them. Three batched reads for the
   * whole page, rather than two per row: a 20-row queue used to cost forty
   * queries before it answered, which is the one thing here that gets slower as
   * the worklist grows.
   */
  private async enrich(rows: Report[]) {
    const [related, history, prior] = await Promise.all([
      this.attach(rows),
      this.actionsByReport(rows),
      this.reportsPerTarget(rows),
    ]);

    return rows.map((report) => ({
      ...report,
      ...related.get(report.id),
      history: history.get(report.id) ?? [],
      priorAgainstTarget: prior.get(report.id) ?? 0,
    }));
  }

  /** The people and listings a page of reports points at, in two reads. */
  private async attach(rows: Report[]): Promise<Map<string, LoadedReport>> {
    const userIds = new Set<string>();
    const listingIds = new Set<string>();
    for (const row of rows) {
      userIds.add(row.reporterId);
      if (row.targetUserId) userIds.add(row.targetUserId);
      if (row.targetListingId) listingIds.add(row.targetListingId);
    }

    const [people, listings] = await Promise.all([
      userIds.size
        ? this.accounts.find({
            where: { id: In([...userIds]) },
            select: { id: true, name: true, status: true },
          })
        : Promise.resolve([] as User[]),
      listingIds.size
        ? this.listings.find({
            where: { id: In([...listingIds]) },
            select: { id: true, title: true, category: true, status: true, ownerId: true },
          })
        : Promise.resolve([] as Listing[]),
    ]);

    const personById = new Map(people.map((person) => [person.id, person]));
    const listingById = new Map(listings.map((listing) => [listing.id, listing]));

    return new Map(
      rows.map((row) => {
        const reporter = personById.get(row.reporterId);
        const targetUser = row.targetUserId ? personById.get(row.targetUserId) : undefined;
        const targetListing = row.targetListingId
          ? listingById.get(row.targetListingId)
          : undefined;
        return [
          row.id,
          {
            reporter: reporter ? { id: reporter.id, name: reporter.name } : null,
            targetUser: targetUser
              ? { id: targetUser.id, name: targetUser.name, status: targetUser.status }
              : null,
            targetListing: targetListing
              ? {
                  id: targetListing.id,
                  title: targetListing.title,
                  category: targetListing.category,
                  status: targetListing.status,
                  ownerId: targetListing.ownerId,
                }
              : null,
          },
        ];
      }),
    );
  }

  /** The ten newest staff actions for each report on the page. */
  private async actionsByReport(rows: Report[]): Promise<Map<string, ReportHistoryEntry[]>> {
    if (!rows.length) return new Map();
    const actions = await this.actions.find({
      where: { reportId: In(rows.map((row) => row.id)) },
      order: { createdAt: 'DESC' },
    });
    return new Map(
      rows.map((row) => [
        row.id,
        actions
          .filter((action) => action.reportId === row.id)
          .slice(0, HISTORY_PER_REPORT)
          .map(toHistoryEntry),
      ]),
    );
  }

  /**
   * How many reports exist against the same student or the same listing, not
   * counting the one being shown. That exclusion was written as
   * `id: Not(report.id)` per row; here each target is counted once for the page
   * and the row subtracts itself from its own target's total.
   */
  private async reportsPerTarget(rows: Report[]): Promise<Map<string, number>> {
    if (!rows.length) return new Map();
    const userIds = [
      ...new Set(rows.map((row) => row.targetUserId).filter((id): id is string => id !== null)),
    ];
    const listingIds = [
      ...new Set(rows.map((row) => row.targetListingId).filter((id): id is string => id !== null)),
    ];
    const [byUser, byListing] = await Promise.all([
      userIds.length
        ? this.countPerTarget('targetUserId', userIds)
        : Promise.resolve(new Map<string, number>()),
      listingIds.length
        ? this.countPerTarget('targetListingId', listingIds)
        : Promise.resolve(new Map<string, number>()),
    ]);

    return new Map(
      rows.map((row) => {
        if (row.targetUserId) return [row.id, (byUser.get(row.targetUserId) ?? 0) - 1];
        if (row.targetListingId) return [row.id, (byListing.get(row.targetListingId) ?? 0) - 1];
        return [row.id, 0];
      }),
    );
  }

  /**
   * `SELECT <column>, COUNT(*) … GROUP BY <column>` for the ids on this page.
   * The column name is one of the two literals in the parameter's type and
   * never comes from the request, so interpolating it cannot carry anything in.
   */
  private async countPerTarget(
    column: 'targetUserId' | 'targetListingId',
    ids: string[],
  ): Promise<Map<string, number>> {
    const rows = await this.reports
      .createQueryBuilder('report')
      .select(`report.${column}`, 'target')
      .addSelect('COUNT(*)', 'count')
      .where(`report.${column} IN (:...ids)`, { ids })
      .groupBy(`report.${column}`)
      .getRawMany<{ target: string; count: string }>();
    return new Map(rows.map((row) => [row.target, Number(row.count)]));
  }
}
