import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import {
  Listing,
  ModerationAction,
  Notification,
  Report,
  User,
} from '../../database/entities/index';
import {
  ModerationActionType,
  NotificationType,
  ReportStatus,
  ReportTargetType,
} from '../../database/schema';
import {
  buildPageMeta,
  page,
  toSkipTake,
  type PaginationQueryDto,
} from '../../common/dto/pagination';
import { Errors } from '../../common/errors';
import { isDuplicateKey } from '../../common/helpers/is-duplicate-key';
import { targetMatchesType, type CreateReportDto } from './dto/report.dto';
import { CLOSE_OUTCOMES, OPEN_STATUSES, type CloseOutcome } from './entities/report.entity';

/**
 * The report itself: filed by a student, and closed by staff.
 *
 * The queue a moderator works through — its filters, the rows beside each
 * report, the history of the account under review — is `ReportWorklistService`,
 * because reading a page of reports well is a different job from deciding one.
 * Everything here writes, and every refusal it raises is a `code` a client
 * branches on.
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Report)
    private readonly reports: Repository<Report>,
    @InjectRepository(Listing)
    private readonly listings: Repository<Listing>,
    @InjectRepository(User)
    private readonly accounts: Repository<User>,
  ) {}

  async file(reporterId: string, dto: CreateReportDto) {
    if (!targetMatchesType(dto)) {
      throw new BadRequestException({
        code: 'REPORT_TARGET_MISMATCH',
        message: 'Provide exactly one target that matches targetType',
      });
    }

    const targetType = dto.targetType;
    if (targetType === ReportTargetType.USER) {
      if (dto.targetUserId === reporterId) {
        throw new BadRequestException({
          code: 'SELF_REPORT',
          message: 'You cannot report yourself',
        });
      }
      if (!(await this.accounts.exists({ where: { id: dto.targetUserId } }))) {
        throw Errors.userNotFound();
      }
    } else {
      const target = await this.listings.findOne({
        where: { id: dto.targetListingId },
        select: { id: true, ownerId: true },
      });
      if (!target) throw Errors.listingNotFound();
      if (target.ownerId === reporterId) {
        // The same rule the user branch above has, for the same reason: a report
        // is one student telling the platform about another, and a listing
        // carries its owner's id, so this one is not anonymous in the way the
        // reporter may have expected.
        throw new BadRequestException({
          code: 'SELF_REPORT',
          message: 'You cannot report your own listing',
        });
      }
    }

    const duplicate = await this.reports.findOne({
      where: {
        reporterId,
        targetType,
        status: In(OPEN_STATUSES),
        ...(targetType === ReportTargetType.USER
          ? { targetUserId: dto.targetUserId }
          : { targetListingId: dto.targetListingId }),
      },
      select: { id: true },
    });
    if (duplicate) throw this.alreadyOpen();

    let created: Report;
    try {
      created = await this.reports.save(
        this.reports.create({
          reporterId,
          targetType,
          targetUserId: targetType === ReportTargetType.USER ? dto.targetUserId : null,
          targetListingId: targetType === ReportTargetType.LISTING ? dto.targetListingId : null,
          reason: dto.reason.trim(),
          category: dto.category,
        }),
      );
    } catch (error) {
      // The read above and this insert are two statements, so the second request
      // in a race can pass the read and be stopped by the database instead — by
      // `reports_open_listing_key` or `reports_open_user_key`, the two partial
      // unique indexes that cover exactly the statuses this read looks for. It
      // gets the answer the read would have given it.
      if (isDuplicateKey(error)) throw this.alreadyOpen();
      throw error;
    }

    return {
      id: created.id,
      targetType: created.targetType,
      category: created.category,
      status: created.status,
      reason: created.reason,
      createdAt: created.createdAt,
    };
  }

  /** The refusal for a second open report, from either of the two ways it is found. */
  private alreadyOpen(): ConflictException {
    return new ConflictException({
      code: 'REPORT_ALREADY_OPEN',
      message: 'You already have an open report for this target',
    });
  }

  async mine(reporterId: string, pagination: PaginationQueryDto) {
    const [items, total] = await this.reports.findAndCount({
      where: { reporterId },
      order: { createdAt: 'DESC' },
      select: {
        id: true,
        targetType: true,
        targetUserId: true,
        targetListingId: true,
        category: true,
        reason: true,
        status: true,
        resolutionNote: true,
        createdAt: true,
        updatedAt: true,
      },
      ...toSkipTake(pagination),
    });
    return page(items, buildPageMeta(pagination, total));
  }

  /**
   * Claiming a report for review. Note what is *not* written: no
   * `moderation_actions` row, so the report records that someone started, not
   * who. Changing that would be a new audit event, not a refactor, so it stays
   * as the route has always answered.
   */
  async startReview(id: string) {
    const report = await this.ensureReport(id);
    const wrongState = new BadRequestException({
      code: 'INVALID_REPORT_STATE',
      message: `Only open reports can start review (current: ${report.status})`,
    });
    if (report.status !== ReportStatus.OPEN) throw wrongState;
    // The status read above is the status this write replaces, so two
    // moderators claiming one report do not both move it out of `OPEN`.
    const written = await this.reports.update(
      { id, status: ReportStatus.OPEN },
      { status: ReportStatus.UNDER_REVIEW },
    );
    if (written.affected === 0) throw wrongState;
    return this.reports.findOne({ where: { id } });
  }

  /**
   * Closing a report is three writes: the report, the audit row, and the note
   * to the student who filed it. They happen together or not at all - a closed
   * report nobody was told about, and an audit row for a report that is still
   * open, are both worse than a failed request a moderator can repeat.
   */
  async close(staffId: string, id: string, status: CloseOutcome, note: string) {
    const report = await this.ensureReport(id);
    // Closed means the status is one of the two outcomes a moderator sets.
    const alreadyClosed = new ConflictException({
      code: 'ALREADY_CLOSED',
      message: 'Report already closed',
    });
    if ((CLOSE_OUTCOMES as readonly ReportStatus[]).includes(report.status)) throw alreadyClosed;
    return this.dataSource.transaction(async (manager) => {
      // The write settles who closed it: two moderators closing one report at
      // the same moment would otherwise both add an audit row and both tell the
      // student, over a report that was closed once. Losing is refused here,
      // before either of the two rows below exists.
      const written = await manager.update(
        Report,
        { id, status: In(OPEN_STATUSES) },
        {
          status,
          resolutionNote: note.trim(),
          resolvedById: staffId,
        },
      );
      if (written.affected === 0) throw alreadyClosed;
      await manager.save(
        manager.create(ModerationAction, {
          moderatorId: staffId,
          action:
            status === ReportStatus.RESOLVED
              ? ModerationActionType.RESOLVE_REPORT
              : ModerationActionType.DISMISS_REPORT,
          reason: note.trim(),
          reportId: id,
          targetType: report.targetType,
          targetUserId: report.targetUserId,
          targetListingId: report.targetListingId,
        }),
      );
      await manager.save(
        manager.create(Notification, {
          userId: report.reporterId,
          type: NotificationType.MODERATION_UPDATE,
          title: `Your report was ${status.toLowerCase()}`,
          body: note.trim(),
          link: `/reports/${id}`,
        }),
      );
      return manager.findOne(Report, { where: { id } });
    });
  }

  private async ensureReport(id: string) {
    const report = await this.reports.findOne({ where: { id } });
    if (!report) throw Errors.reportNotFound();
    return report;
  }
}
