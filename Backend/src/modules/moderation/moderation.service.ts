import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import type { FindOptionsWhere } from 'typeorm';
import {
  Listing,
  ModerationAction,
  Notification,
  Report,
  Session,
  User,
} from '../../database/entities/index';
import {
  AccountStatus,
  ListingStatus,
  ModerationActionType,
  NotificationType,
  ReportStatus,
  ReportTargetType,
} from '../../database/schema';
import { buildPageMeta, page, toSkipTake } from '../../common/dto/pagination';
import { Errors } from '../../common/errors';
import { isAdmin, type StaffActor } from '../../common/helpers/staff';
import type { ModerationActionsQueryDto } from './dto/moderation.dto';
import type { NotifyInput } from '../notifications/notifications.service';
import { ListingsService } from '../listings/listings.service';

export interface ActionResult {
  id: string;
  action: ModerationActionType;
  reason: string;
  targetUserId: string | null;
  targetListingId: string | null;
  createdAt: Date;
}

/**
 * What a student reads where an owner's answer should have been, when the
 * account behind the listing was suspended instead. The same text goes into the
 * thread and into the notification about it, and it is deliberately not the
 * closing sentence: a suspended listing is hidden by a decision, not withdrawn
 * by its owner, and reopening it is not the student's option.
 */
const SUSPENDED_OWNER_RESPONSE = 'The account behind this listing was suspended.';

/**
 * The staff decisions, and the audit row that proves each one was made.
 *
 * Every method here writes a `moderation_actions` row. That is not paperwork:
 * it is the only record a student can appeal against, and the only way a
 * moderator's judgement can be reviewed later. It is also why the state checks
 * run before anything is written - a decision that was refused still gets an
 * audit row, and one that was never made does not.
 */
@Injectable()
export class ModerationService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Listing)
    private readonly listings: Repository<Listing>,
    @InjectRepository(User)
    private readonly accounts: Repository<User>,
    @InjectRepository(Report)
    private readonly reports: Repository<Report>,
    @InjectRepository(ModerationAction)
    private readonly actions: Repository<ModerationAction>,
    private readonly listingsService: ListingsService,
  ) {}

  async hideListing(staff: StaffActor, listingId: string, reason: string, reportId?: string) {
    const listing = await this.ensureListing(listingId);
    const alreadyHidden = new BadRequestException({
      code: 'ALREADY_HIDDEN',
      message: 'Listing is already hidden',
    });
    if (listing.status === ListingStatus.HIDDEN) throw alreadyHidden;
    // Un-hiding sets ACTIVE, so a hidden closed listing would come back as an
    // open one; the only way a closed row is hidden is by losing that state
    // first, which is the owner's decision to make, not a moderator's.
    if (listing.status === ListingStatus.CLOSED) {
      throw new BadRequestException({
        code: 'LISTING_CLOSED',
        message: 'A closed listing cannot be hidden',
      });
    }
    await this.assertReportNotClosed(reportId);

    return this.dataSource.transaction(async (manager) => {
      // Conditional on the status this method read, so two moderators hiding
      // one listing write one audit row and send the owner one notification.
      const written = await manager.update(
        Listing,
        { id: listingId, status: listing.status },
        { status: ListingStatus.HIDDEN },
      );
      if (written.affected === 0) throw alreadyHidden;
      const action = await this.logAction(manager, {
        moderatorId: staff.id,
        action: ModerationActionType.HIDE_LISTING,
        reason,
        targetType: ReportTargetType.LISTING,
        targetListingId: listingId,
        reportId,
      });
      await this.notify(manager, {
        userId: listing.ownerId,
        type: NotificationType.MODERATION_UPDATE,
        title: 'One of your listings was hidden',
        body: reason,
        link: `/listings/${listingId}`,
      });
      return {
        action: this.toResult(action),
        listing: { id: listingId, status: ListingStatus.HIDDEN },
      };
    });
  }

  async unhideListing(staff: StaffActor, listingId: string, reason: string) {
    const listing = await this.ensureListing(listingId);
    const notHidden = new BadRequestException({
      code: 'NOT_HIDDEN',
      message: 'Listing is not hidden',
    });
    if (listing.status !== ListingStatus.HIDDEN) throw notHidden;
    return this.dataSource.transaction(async (manager) => {
      // A suspension hides everything the account posted, and this route is the
      // way a listing comes back — so without the owner's status here, one
      // moderator un-hiding a banned seller's item puts it back in the search
      // results for buyers to write to, against an account that can no longer
      // answer. The read takes the owner's row lock, which is the row
      // `suspendUser()` updates: a suspension landing while this runs either
      // happened first (this read sees it and refuses) or waits for this
      // transaction, after which the hide it performs takes the listing back.
      const owner = await manager.findOne(User, {
        where: { id: listing.ownerId },
        lock: { mode: 'pessimistic_write' },
        select: { id: true, status: true },
      });
      if (owner?.status === AccountStatus.SUSPENDED) {
        throw new ForbiddenException({
          code: 'OWNER_SUSPENDED',
          message: 'Restore the account before its listing goes back on view',
        });
      }
      // Same as hiding: the write carries the status this method saw, so a
      // second unhide loses here instead of logging a decision nobody made.
      const written = await manager.update(
        Listing,
        { id: listingId, status: listing.status },
        { status: ListingStatus.ACTIVE },
      );
      if (written.affected === 0) throw notHidden;
      const action = await this.logAction(manager, {
        moderatorId: staff.id,
        action: ModerationActionType.UNHIDE_LISTING,
        reason,
        targetType: ReportTargetType.LISTING,
        targetListingId: listingId,
      });
      await this.notify(manager, {
        userId: listing.ownerId,
        type: NotificationType.MODERATION_UPDATE,
        title: 'Your listing is visible again',
        body: reason,
        link: `/listings/${listingId}`,
      });
      return {
        action: this.toResult(action),
        listing: { id: listingId, status: ListingStatus.ACTIVE },
      };
    });
  }

  async warnUser(staff: StaffActor, userId: string, reason: string, reportId?: string) {
    const target = await this.ensureUser(userId);
    // The same rule suspension applies, in the one place it was missing: a
    // warning is a letter an administrator receives from a role that does not
    // outrank them. An administrator warning an administrator stays allowed —
    // nobody is above the audit trail, and this is the trail's own record.
    if (isAdmin(target.role) && !isAdmin(staff.role)) {
      throw new ForbiddenException({
        code: 'PROTECTED_ACCOUNT',
        message: 'Administrators cannot be warned by a moderator',
      });
    }
    await this.assertReportNotClosed(reportId);

    // The one action here that changes no row of its own, so there is nothing
    // for a transaction to cover: the audit row and the inbox row are written
    // one after the other. See the note on `logAction()`.
    const manager = this.actions.manager;
    const action = await this.logAction(manager, {
      moderatorId: staff.id,
      action: ModerationActionType.WARN_USER,
      reason,
      targetType: ReportTargetType.USER,
      targetUserId: userId,
      reportId,
    });
    await this.notify(manager, {
      userId,
      type: NotificationType.MODERATION_UPDATE,
      title: 'Official warning',
      body: reason,
      link: '/notifications',
    });
    return { action: this.toResult(action) };
  }

  /** Suspension is admin-only, per the role matrix in the scope document. */
  async suspendUser(staff: StaffActor, userId: string, reason: string, reportId?: string) {
    if (!isAdmin(staff.role)) {
      throw new ForbiddenException({
        code: 'ADMIN_ONLY',
        message: 'Only administrators may suspend accounts',
      });
    }
    const target = await this.ensureUser(userId);
    // Applies to every administrator, including the caller: locking an admin
    // out has to stay a decision somebody else can undo.
    if (isAdmin(target.role)) {
      throw new ForbiddenException({
        code: 'PROTECTED_ACCOUNT',
        message: 'Administrators cannot be suspended',
      });
    }
    if (target.status === AccountStatus.SUSPENDED) {
      throw new BadRequestException({
        code: 'ALREADY_SUSPENDED',
        message: 'Account is already suspended',
      });
    }
    await this.assertReportNotClosed(reportId);

    return this.dataSource.transaction(async (manager) => {
      await manager.update(User, { id: userId }, { status: AccountStatus.SUSPENDED });
      // Signed-in devices lose access immediately.
      await manager.delete(Session, { userId });
      // So does everything the account had on public display: a suspension that
      // left the listings standing would keep pointing students at an owner who
      // cannot answer them. The write carries the status just read, so a listing
      // a moderator hid a moment before is not rewritten, and no closed one is
      // reopened by any of this. `restoreUser()` deliberately leaves them hidden
      // — un-hiding is a decision of its own, made one listing at a time.
      const live = await manager.find(Listing, {
        where: { ownerId: userId, status: ListingStatus.ACTIVE },
        select: { id: true },
      });
      await manager.update(
        Listing,
        { ownerId: userId, status: ListingStatus.ACTIVE },
        { status: ListingStatus.HIDDEN },
      );
      // The threads still waiting inside them are answered by the suspension
      // itself, in the same transaction as the hide, with the wording a close
      // does not use. No per-listing notification goes to the owner: the
      // suspension letter below already says what happened to the account.
      for (const listing of live) {
        await this.listingsService.settlePendingInquiries(
          manager,
          listing.id,
          SUSPENDED_OWNER_RESPONSE,
        );
      }
      const action = await this.logAction(manager, {
        moderatorId: staff.id,
        action: ModerationActionType.SUSPEND_ACCOUNT,
        reason,
        targetType: ReportTargetType.USER,
        targetUserId: userId,
        reportId,
      });
      await this.notify(manager, {
        userId,
        type: NotificationType.ACCOUNT_UPDATE,
        title: 'Your account was suspended',
        body: reason,
        link: '/auth/me',
      });
      return {
        action: this.toResult(action),
        user: { id: userId, status: AccountStatus.SUSPENDED },
      };
    });
  }

  async restoreUser(staff: StaffActor, userId: string, reason: string) {
    if (!isAdmin(staff.role)) {
      throw new ForbiddenException({
        code: 'ADMIN_ONLY',
        message: 'Only administrators may restore accounts',
      });
    }
    const target = await this.ensureUser(userId);
    if (target.status !== AccountStatus.SUSPENDED) {
      throw new BadRequestException({ code: 'NOT_SUSPENDED', message: 'Account is not suspended' });
    }
    return this.dataSource.transaction(async (manager) => {
      await manager.update(User, { id: userId }, { status: AccountStatus.ACTIVE });
      const action = await this.logAction(manager, {
        moderatorId: staff.id,
        action: ModerationActionType.RESTORE_ACCOUNT,
        reason,
        targetType: ReportTargetType.USER,
        targetUserId: userId,
      });
      await this.notify(manager, {
        userId,
        type: NotificationType.ACCOUNT_UPDATE,
        title: 'Your account was restored',
        body: reason,
        link: '/auth/me',
      });
      return {
        action: this.toResult(action),
        user: { id: userId, status: AccountStatus.ACTIVE },
      };
    });
  }

  /**
   * The audit trail, newest first, with the moderator and the report attached.
   *
   * `action` is matched without regard to case, which is why it is checked here
   * instead of with `@IsIn` in the DTO: a filter a staff member types into a
   * search box is allowed to be lowercase, and a 400 would tell them nothing
   * useful.
   */
  async history(query: ModerationActionsQueryDto) {
    const where: FindOptionsWhere<ModerationAction> = {};
    if (query.moderatorId) where.moderatorId = query.moderatorId;
    if (query.action) {
      const values = Object.values(ModerationActionType);
      const wanted = query.action.toUpperCase();
      const normalized = values.find((value) => value === wanted);
      if (!normalized) {
        throw new BadRequestException({
          code: 'BAD_ACTION',
          message: `action must be one of ${values.join(', ')}`,
        });
      }
      where.action = normalized;
    }

    const [rows, total] = await this.actions.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      ...toSkipTake(query),
    });
    const loaded = await this.attach(rows);
    return page(loaded, buildPageMeta(query, total));
  }

  /* --------------------------------------------------------------- the trail --- */

  /**
   * The audit row every action here writes — the one piece of paper that makes
   * a staff decision appealable, so it is written by this method and nowhere
   * else.
   *
   * The manager comes from the caller because four of the five actions change a
   * second row in the same transaction and must not be written before it
   * succeeds; `warnUser()` changes none, and passes the repository's own
   * manager instead.
   */
  private logAction(
    manager: EntityManager,
    entry: {
      moderatorId: string;
      action: ModerationActionType;
      reason: string;
      targetType: ReportTargetType;
      targetUserId?: string;
      targetListingId?: string;
      reportId?: string;
    },
  ): Promise<ModerationAction> {
    return manager.save(
      manager.create(ModerationAction, {
        moderatorId: entry.moderatorId,
        action: entry.action,
        reason: entry.reason,
        targetType: entry.targetType,
        targetUserId: entry.targetUserId ?? null,
        targetListingId: entry.targetListingId ?? null,
        reportId: entry.reportId ?? null,
      }),
    );
  }

  /** Telling the student what was decided, in the same transaction as the decision. */
  private notify(manager: EntityManager, input: NotifyInput): Promise<Notification> {
    return manager.save(manager.create(Notification, input));
  }

  /* ---------------------------------------------------------------- loading --- */

  /**
   * The moderator and the report behind each logged action.
   *
   * Only the named columns are taken from `users`: a moderator row in an audit
   * log has no business carrying a password hash.
   */
  private async attach(rows: ModerationAction[]) {
    const moderatorIds = [...new Set(rows.map((row) => row.moderatorId))];
    const reportIds = [
      ...new Set(rows.map((row) => row.reportId).filter((id): id is string => Boolean(id))),
    ];

    const [moderators, reports] = await Promise.all([
      this.accounts.find({
        where: { id: In(moderatorIds) },
        select: { id: true, name: true, role: true },
      }),
      reportIds.length
        ? this.reports.find({
            where: { id: In(reportIds) },
            select: { id: true, targetType: true, category: true },
          })
        : Promise.resolve([] as Report[]),
    ]);

    const moderatorById = new Map(moderators.map((moderator) => [moderator.id, moderator]));
    const reportById = new Map(reports.map((report) => [report.id, report]));

    return rows.map((row) => ({
      ...row,
      moderator: moderatorById.get(row.moderatorId) ?? null,
      report: row.reportId ? (reportById.get(row.reportId) ?? null) : null,
    }));
  }

  /* ------------------------------------------------------------- guarantees --- */

  private async ensureListing(id: string) {
    const listing = await this.listings.findOne({
      where: { id },
      select: { id: true, status: true, ownerId: true, title: true },
    });
    if (!listing) throw Errors.listingNotFound();
    return listing;
  }

  private async ensureUser(id: string) {
    const user = await this.accounts.findOne({
      where: { id },
      select: { id: true, role: true, status: true, name: true },
    });
    if (!user) throw Errors.userNotFound();
    return user;
  }

  /**
   * Actions are attached to a live report, never to a closed one: closing a
   * report means the decision is recorded, and editing the record afterwards
   * would make the audit trail a story told after the fact.
   */
  private async assertReportNotClosed(reportId?: string) {
    if (!reportId) return;
    const report = await this.reports.findOne({
      where: { id: reportId },
      select: { status: true },
    });
    if (!report) throw Errors.reportNotFound();
    if (report.status === ReportStatus.RESOLVED || report.status === ReportStatus.DISMISSED) {
      throw new BadRequestException({
        code: 'REPORT_CLOSED',
        message: 'Attach actions to a report before closing it',
      });
    }
  }

  private toResult(action: ModerationAction): ActionResult {
    return {
      id: action.id,
      action: action.action,
      reason: action.reason,
      targetUserId: action.targetUserId,
      targetListingId: action.targetListingId,
      createdAt: action.createdAt,
    };
  }
}
