import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';

/**
 * The error objects that were being typed out again in more than one place.
 *
 * Only responses identical in class, `code` and `message` are here, plus the
 * three factories that share class and code but take the differing words as an
 * argument: `noFields()`, `invalidSession()` and `invalidTokenLink()`.
 *
 * Deliberately absent, because folding them in would change the status code a
 * client receives: `USER_NOT_FOUND` as an `UnauthorizedException` from
 * `GET /api/auth/me`, and every other error thrown exactly once
 * (`INQUIRY_NOT_FOUND`, `BAD_STATUS` among them).
 *
 * Factories rather than ready-made exceptions: a thrown error captures its
 * stack at construction, so one shared instance would report every failure as
 * coming from this file.
 */
export const Errors = {
  userNotFound: () => new NotFoundException({ code: 'USER_NOT_FOUND', message: 'Unknown user' }),
  listingNotFound: () =>
    new NotFoundException({ code: 'LISTING_NOT_FOUND', message: 'Unknown listing' }),
  /** A moderation action asked about a report that is not in the table. */
  reportNotFound: () =>
    new NotFoundException({ code: 'REPORT_NOT_FOUND', message: 'Unknown report' }),
  /** Both inbox routes answer this way: mark-read looked by id, delete by id and owner. */
  notificationNotFound: () =>
    new NotFoundException({ code: 'NOTIFICATION_NOT_FOUND', message: 'Unknown notification' }),
  /** The caller has no usable session, wherever in the chain that was noticed. */
  authenticationRequired: () =>
    new UnauthorizedException({
      code: 'AUTHENTICATION_REQUIRED',
      message: 'Authentication required',
    }),
  /**
   * A credential the caller presented could not be turned into an account.
   * The two sentences are the two halves of the check — the token itself and
   * the row behind it — so the reason is the caller's to name.
   */
  invalidSession: (reason = 'Invalid or expired session') =>
    new UnauthorizedException({ code: 'INVALID_SESSION', message: reason }),
  /** The account a mailed reset link was made for no longer exists. */
  unknownAccount: () =>
    new BadRequestException({ code: 'USER_NOT_FOUND', message: 'Unknown account' }),
  /** A registration or reset link that was used, guessed, or left too long in the mailbox. */
  invalidTokenLink: (label: string) =>
    new BadRequestException({
      code: 'INVALID_OR_EXPIRED_TOKEN',
      message: `That ${label} link is invalid or has expired`,
    }),
  /**
   * A `PATCH` body that names no field worth writing. The class, code and first
   * words are the rule; the field list is each endpoint's own, since telling a
   * student what they could have sent is the useful half. `hasPatchValues()`
   * decides it for the two student routes, while `AdminService.correctProfile`
   * asks its own question — it treats `''` as absent and trims before writing.
   */
  noFields: (fields: string) =>
    new BadRequestException({
      code: 'NO_FIELDS',
      message: `Provide at least one of: ${fields}`,
    }),
  /**
   * A listing a moderator hid. All three owner writes that can reach a hidden
   * row refuse with the same words: only staff can lift the decision, so no
   * amount of editing or status changes makes the listing visible again.
   */
  listingHidden: () =>
    new ForbiddenException({
      code: 'LISTING_HIDDEN',
      message: 'This listing is hidden by moderation',
    }),
  /** Every refusal that a block between two students causes, in either direction. */
  blockedContact: () =>
    new ForbiddenException({
      code: 'BLOCKED',
      message: 'Contact is not possible between blocked students',
    }),
  /** The address is taken — whether the student finished registering it or an admin typed it in. */
  accountExists: () =>
    new ConflictException({
      code: 'ACCOUNT_EXISTS',
      message: 'An account with that address already exists',
    }),
  /** The override an administrator asked for had nothing left to do. */
  alreadyVerified: () =>
    new BadRequestException({ code: 'ALREADY_VERIFIED', message: 'Address already verified' }),
  /** The pending-inquiry rule, from the friendly check and from the unique index. */
  inquiryAlreadyPending: () =>
    new ConflictException({
      code: 'INQUIRY_ALREADY_PENDING',
      message: 'You already have a pending inquiry on this listing',
    }),
};
