import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Like, Repository, type EntityManager } from 'typeorm';
import {
  Inquiry,
  Listing,
  ModerationAction,
  Notification,
  Report,
  User,
  Verification,
} from '../../database/entities/index';
import {
  AccountStatus,
  ModerationActionType,
  NotificationType,
  ReportTargetType,
  Role,
} from '../../database/schema';
import { Errors } from '../../common/errors';
import { isDuplicateKey } from '../../common/helpers/is-duplicate-key';
import type { StaffActor } from '../../common/helpers/staff';
import { INSTITUTION_EMAIL_SUFFIX, isInstitutionEmail } from '../../config/env';
import { hashPassword } from '../auth/auth.constants';
import { verificationIdentifierForUser } from '../auth/verification.service';
import { MAX_DEPARTMENT_LENGTH, MAX_NAME_LENGTH } from '../users/dto/user.dto';
import { toAdminRow, type AssignRoleDto, type CreatePlatformUserDto } from './dto/admin.dto';

/**
 * The write side of the back office: the routes that change who somebody is, and
 * the audit row each one owes for it.
 *
 * Every route here that changes permissions or identity writes a
 * `moderation_actions` row in the same transaction as the change, so no role has
 * moved and no account disappeared without a named person and a reason attached.
 * Reading the platform has no such shape, which is why it sits beside this
 * service in `AdminDirectoryService`.
 *
 * One power is missing on purpose: making somebody an administrator. That belongs
 * to SQL an operator writes by hand, so the admin roster is something a code
 * review can answer and a running server cannot change.
 */
@Injectable()
export class AdminService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(User)
    private readonly accounts: Repository<User>,
    @InjectRepository(Listing)
    private readonly listings: Repository<Listing>,
    @InjectRepository(Inquiry)
    private readonly inquiries: Repository<Inquiry>,
    @InjectRepository(Report)
    private readonly reports: Repository<Report>,
    @InjectRepository(ModerationAction)
    private readonly actions: Repository<ModerationAction>,
  ) {}

  /**
   * The only way a role changes at runtime, and every change is recorded. Two
   * things it cannot do, both deliberate:
   *
   * - Grant ADMIN. `AssignRoleDto` accepts USER and MODERATOR only; were ADMIN
   *   grantable, one stolen admin session would add an untraceable administrator
   *   whose audit row says only that a legitimate session asked.
   * - Move an existing administrator. They are `users` rows an operator inserts
   *   with SQL of their own, so no route can change or remove them.
   *
   * No "last administrator" guard is needed: ADMIN cannot be granted, an admin
   * cannot demote themselves, and any other demotion leaves one standing.
   */
  async assignRole(admin: StaffActor, userId: string, dto: AssignRoleDto) {
    const target = await this.accounts.findOne({ where: { id: userId } });
    if (!target) throw Errors.userNotFound();
    // Before the role rule below, so an administrator asking about their own
    // account is told which rule they are breaking rather than the general one.
    if (target.id === admin.id) {
      throw new BadRequestException({
        code: 'SELF_DEMOTION',
        message: 'You cannot remove your own administrator role',
      });
    }
    if (target.role === Role.ADMIN) {
      throw new ForbiddenException({
        code: 'ADMIN_PROTECTED',
        message: 'An administrator cannot be changed through this route',
      });
    }
    if (target.role === dto.role) {
      throw new BadRequestException({ code: 'NO_CHANGE', message: 'Role is already set' });
    }

    return this.dataSource.transaction(async (manager) => {
      await manager.update(User, { id: userId }, { role: dto.role });
      await this.logUserAction(manager, {
        moderatorId: admin.id,
        action: ModerationActionType.CHANGE_ROLE,
        reason: `${dto.reason} (${target.role} -> ${dto.role})`,
        targetUserId: userId,
      });
      await manager.save(
        manager.create(Notification, {
          userId,
          type: NotificationType.ACCOUNT_UPDATE,
          title: `Your role is now ${dto.role}`,
          body: dto.reason,
          link: '/auth/me',
        }),
      );
      return { id: userId, role: dto.role };
    });
  }

  /**
   * Adds an account the mail system could not produce — the exception path, for a
   * real institutional address whose mailbox is unreachable (a graduated alumni's
   * relay, a closed mailbox). The account is written already verified and the
   * reason is mandatory and logged because the administrator signing it *is* the
   * proof.
   *
   * The password is temporary and handed over in person; the student replaces it
   * with `POST /api/auth/change-password`, which logs out every other device.
   */
  async createUser(admin: StaffActor, dto: CreatePlatformUserDto) {
    if (!isInstitutionEmail(dto.email)) {
      throw new ForbiddenException({
        code: 'UNAPPROVED_EMAIL_DOMAIN',
        message: `Only ${INSTITUTION_EMAIL_SUFFIX} addresses may have an account`,
      });
    }
    if (await this.accounts.findOne({ where: { email: dto.email }, select: { id: true } })) {
      throw Errors.accountExists();
    }

    let account: User;
    try {
      account = await this.dataSource.transaction(async (manager) => {
        const created = await manager.save(
          manager.create(User, {
            email: dto.email,
            name: dto.name.trim(),
            // Verified from the first write: no link was mailed, so nothing can
            // confirm it later either.
            emailVerified: true,
            passwordHash: await hashPassword(dto.password),
            role: dto.role ?? Role.USER,
            status: AccountStatus.ACTIVE,
            department: dto.department?.trim() ?? null,
          }),
        );
        await this.logUserAction(manager, {
          moderatorId: admin.id,
          action: ModerationActionType.MANUAL_VERIFICATION,
          reason: `Account created by an administrator: ${dto.reason.trim()}`,
          targetUserId: created.id,
        });
        await manager.save(
          manager.create(Notification, {
            userId: created.id,
            type: NotificationType.ACCOUNT_UPDATE,
            title: 'An administrator created your account',
            body: 'Sign in and choose your own password from your account settings.',
            link: '/auth/me',
          }),
        );
        return created;
      });
    } catch (error) {
      // The read above and the insert are two statements, so the loser of a race
      // learns about the winner from `users_email_key`. Like `auth.service.ts` it
      // answers 409, not a 500 (the loser did nothing wrong), and the rolled-back
      // transaction leaves no half-written account or orphan notification.
      if (isDuplicateKey(error)) throw Errors.accountExists();
      throw error;
    }

    return toAdminRow(account);
  }

  /**
   * Removes an account outright, and refuses to when anything would be lost.
   *
   * An account owns listings, threads, complaints and — for a moderator — the
   * record of every decision they took, and PostgreSQL removes those with the
   * account (`ON DELETE CASCADE`). An unconditional delete would quietly delete
   * the audit trail too. So: an account with no history can be deleted; anything
   * with a history is suspended instead, which logs the person out, keeps every
   * row, and can be undone.
   *
   * An administrator cannot be removed here either — they are rows an operator
   * inserts by hand, so the way to retire one is a `DELETE` of that row.
   */
  async removeUser(admin: StaffActor, userId: string, reason: string) {
    const target = await this.accounts.findOne({ where: { id: userId } });
    if (!target) throw Errors.userNotFound();
    if (target.id === admin.id) {
      throw new BadRequestException({
        code: 'SELF_REMOVAL',
        message: 'You cannot delete the account you are signed in to',
      });
    }
    if (target.role === Role.ADMIN) {
      throw new ForbiddenException({
        code: 'ADMIN_PROTECTED',
        message: 'An administrator cannot be removed through this route',
      });
    }

    const history = await this.countHistory(userId);
    if (history.total) {
      throw new ConflictException({
        code: 'ACCOUNT_HAS_HISTORY',
        message:
          `Deleting this account would delete ${history.total} record(s) with it ` +
          `(listings, inquiries, reports or logged decisions). Suspend it instead.`,
        details: history.details,
      });
    }

    const { email, name } = target;
    await this.dataSource.transaction(async (manager) => {
      // Logged before the delete, in the same transaction: `targetUserId` is a
      // plain column rather than a reference, so the row outlives the account it
      // describes, which is exactly what an audit trail has to do.
      await this.logUserAction(manager, {
        moderatorId: admin.id,
        action: ModerationActionType.DELETE_ACCOUNT,
        reason: `Account ${email} (${name}) deleted: ${reason.trim()}`,
        targetUserId: userId,
      });
      // `verifications` has no foreign key onto `users` — its `identifier` holds
      // `<purpose>:<user id>` as text (a registration link names an address
      // instead), so the cascade that clears sessions and listings cannot reach
      // these rows. Without this delete, a reset link mailed just before removal
      // would stay live for the rest of its TTL against an id that no longer
      // resolves, and `consume()` would hand that id back to the caller.
      await manager.delete(Verification, {
        identifier: Like(verificationIdentifierForUser(userId)),
      });
      await manager.delete(User, { id: userId });
    });

    return { deleted: true, id: userId, email };
  }

  /**
   * Institutional exceptions: an admin can mark an address verified when the
   * mailbox itself cannot be reached (e.g. graduated student, relay address).
   */
  async markEmailVerified(admin: StaffActor, userId: string, reason: string) {
    if (reason.trim().length < 5) {
      throw new BadRequestException({
        code: 'REASON_REQUIRED',
        message: 'A reason is required to override verification',
      });
    }
    const user = await this.accounts.findOne({ where: { id: userId } });
    if (!user) throw Errors.userNotFound();
    if (user.emailVerified) {
      throw Errors.alreadyVerified();
    }
    return this.dataSource.transaction(async (manager) => {
      await manager.update(User, { id: userId }, { emailVerified: true });
      await this.logUserAction(manager, {
        moderatorId: admin.id,
        action: ModerationActionType.MANUAL_VERIFICATION,
        reason: `Manual verification override: ${reason.trim()}`,
        targetUserId: userId,
      });
      await manager.save(
        manager.create(Notification, {
          userId,
          type: NotificationType.VERIFICATION_UPDATE,
          title: 'Your account was verified by an administrator',
          body: reason.trim(),
          link: '/auth/me',
        }),
      );
      return { id: userId, emailVerified: true };
    });
  }

  /** A staff edit of the identity fields a student cannot always correct alone. */
  async correctProfile(admin: StaffActor, userId: string, dto: Record<string, unknown>) {
    const patch: { name?: string; department?: string } = {};
    for (const key of ['name', 'department'] as const) {
      const value = dto[key];
      if (typeof value === 'string' && value.trim()) {
        // The ceiling the student's own route also enforces. Without it this
        // request writes what `PATCH /api/users/me` refuses, into `text` columns
        // that notice nothing — and a five thousand character name is not a
        // correction, it is a card nobody can render.
        const limit = key === 'name' ? MAX_NAME_LENGTH : MAX_DEPARTMENT_LENGTH;
        const trimmed = value.trim();
        if (trimmed.length > limit) {
          throw new BadRequestException({
            code: 'FIELD_TOO_LONG',
            message: `${key} must be ${limit} characters or fewer`,
          });
        }
        patch[key] = trimmed;
      }
    }
    if (!Object.keys(patch).length) {
      throw Errors.noFields('name, department');
    }
    const user = await this.accounts.findOne({ where: { id: userId } });
    if (!user) throw Errors.userNotFound();

    return this.dataSource.transaction(async (manager) => {
      await manager.update(User, { id: userId }, patch);
      await this.logUserAction(manager, {
        moderatorId: admin.id,
        action: ModerationActionType.PROFILE_CORRECTION,
        reason: `Profile correction: ${Object.keys(patch).join(', ')}`,
        targetUserId: userId,
      });
      return { id: userId, ...patch };
    });
  }

  /* ---------------------------------------------------------------- helpers --- */

  /**
   * The audit row every change of permission or identity writes beside the change:
   * who decided, what, why, and which account. `targetType` is always USER here —
   * a moderator's actions against a listing are the moderation module's shape.
   */
  private async logUserAction(
    manager: EntityManager,
    entry: {
      moderatorId: string;
      action: ModerationActionType;
      reason: string;
      targetUserId: string;
    },
  ): Promise<void> {
    await manager.save(
      manager.create(ModerationAction, {
        moderatorId: entry.moderatorId,
        action: entry.action,
        reason: entry.reason,
        targetType: ReportTargetType.USER,
        targetUserId: entry.targetUserId,
      }),
    );
  }

  /**
   * How much the platform would lose by deleting one account, counted before the
   * delete is allowed to happen. Six counts rather than one query with subselects:
   * this runs when an admin presses a button, rarely enough that the plainer form
   * is worth keeping.
   */
  private async countHistory(
    userId: string,
  ): Promise<{ total: number; details: Array<{ path: string; message: string }> }> {
    const counts = await Promise.all([
      this.listings.count({ where: { ownerId: userId } }),
      this.inquiries.count({ where: { inquirerId: userId } }),
      this.inquiries.count({ where: { ownerId: userId } }),
      this.reports.count({ where: { reporterId: userId } }),
      this.reports.count({ where: { targetUserId: userId } }),
      this.actions.count({ where: { moderatorId: userId } }),
    ]);
    const labels = [
      ['listings', 'listing(s) posted'],
      ['inquiriesSent', 'inquiry(ies) sent'],
      ['inquiriesReceived', 'inquiry(ies) received'],
      ['reportsFiled', 'report(s) filed'],
      ['reportsAgainst', 'report(s) about this account'],
      ['moderationDecisions', 'logged moderation decision(s)'],
    ] as const;

    const labelled = counts.map((count, index) => ({
      count,
      path: labels[index][0],
      noun: labels[index][1],
    }));

    // Only the non-zero counts are returned: an admin reading "3 listings" out
    // of a list of six zeroes is reading nothing.
    const details = labelled
      .filter((entry) => entry.count > 0)
      .map((entry) => ({ path: entry.path, message: `${entry.count} ${entry.noun}` }));

    return { total: labelled.reduce((sum, entry) => sum + entry.count, 0), details };
  }
}
