import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';

export const Errors = {
  userNotFound: () => new NotFoundException({ code: 'USER_NOT_FOUND', message: 'Unknown user' }),
  listingNotFound: () =>
    new NotFoundException({ code: 'LISTING_NOT_FOUND', message: 'Unknown listing' }),

  reportNotFound: () =>
    new NotFoundException({ code: 'REPORT_NOT_FOUND', message: 'Unknown report' }),

  notificationNotFound: () =>
    new NotFoundException({ code: 'NOTIFICATION_NOT_FOUND', message: 'Unknown notification' }),

  authenticationRequired: () =>
    new UnauthorizedException({
      code: 'AUTHENTICATION_REQUIRED',
      message: 'Authentication required',
    }),

  invalidSession: (reason = 'Invalid or expired session') =>
    new UnauthorizedException({ code: 'INVALID_SESSION', message: reason }),

  unknownAccount: () =>
    new BadRequestException({ code: 'USER_NOT_FOUND', message: 'Unknown account' }),

  invalidTokenLink: (label: string) =>
    new BadRequestException({
      code: 'INVALID_OR_EXPIRED_TOKEN',
      message: `That ${label} link is invalid or has expired`,
    }),

  noFields: (fields: string) =>
    new BadRequestException({
      code: 'NO_FIELDS',
      message: `Provide at least one of: ${fields}`,
    }),

  listingHidden: () =>
    new ForbiddenException({
      code: 'LISTING_HIDDEN',
      message: 'This listing is hidden by moderation',
    }),

  blockedContact: () =>
    new ForbiddenException({
      code: 'BLOCKED',
      message: 'Contact is not possible between blocked students',
    }),

  accountExists: () =>
    new ConflictException({
      code: 'ACCOUNT_EXISTS',
      message: 'An account with that address already exists',
    }),

  alreadyVerified: () =>
    new BadRequestException({ code: 'ALREADY_VERIFIED', message: 'Address already verified' }),

  inquiryAlreadyPending: () =>
    new ConflictException({
      code: 'INQUIRY_ALREADY_PENDING',
      message: 'You already have a pending inquiry on this listing',
    }),
};
