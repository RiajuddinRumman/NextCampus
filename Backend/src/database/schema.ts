import { randomBytes } from 'node:crypto';

export const Role = {
  USER: 'USER',
  MODERATOR: 'MODERATOR',
  ADMIN: 'ADMIN',
} as const;
export type Role = (typeof Role)[keyof typeof Role];

export const AccountStatus = {
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
} as const;
export type AccountStatus = (typeof AccountStatus)[keyof typeof AccountStatus];

export const ListingCategory = {
  MARKETPLACE: 'MARKETPLACE',
  TUITION: 'TUITION',
  GROUP_FINDER: 'GROUP_FINDER',
  LOST_FOUND: 'LOST_FOUND',
  COMMUTE: 'COMMUTE',
} as const;
export type ListingCategory = (typeof ListingCategory)[keyof typeof ListingCategory];

export const ListingStatus = {
  ACTIVE: 'ACTIVE',
  CLOSED: 'CLOSED',
  HIDDEN: 'HIDDEN',
} as const;
export type ListingStatus = (typeof ListingStatus)[keyof typeof ListingStatus];

export const InquiryStatus = {
  PENDING: 'PENDING',
  ACCEPTED: 'ACCEPTED',
  DECLINED: 'DECLINED',
  CANCELLED: 'CANCELLED',
} as const;
export type InquiryStatus = (typeof InquiryStatus)[keyof typeof InquiryStatus];

export const ReportTargetType = {
  USER: 'USER',
  LISTING: 'LISTING',
} as const;
export type ReportTargetType = (typeof ReportTargetType)[keyof typeof ReportTargetType];

export const ReportStatus = {
  OPEN: 'OPEN',
  UNDER_REVIEW: 'UNDER_REVIEW',
  RESOLVED: 'RESOLVED',
  DISMISSED: 'DISMISSED',
} as const;
export type ReportStatus = (typeof ReportStatus)[keyof typeof ReportStatus];

export const NotificationType = {
  INQUIRY_RECEIVED: 'INQUIRY_RECEIVED',
  INQUIRY_ACCEPTED: 'INQUIRY_ACCEPTED',
  INQUIRY_DECLINED: 'INQUIRY_DECLINED',
  INQUIRY_RESPONSE: 'INQUIRY_RESPONSE',
  ACCOUNT_UPDATE: 'ACCOUNT_UPDATE',
  VERIFICATION_UPDATE: 'VERIFICATION_UPDATE',
  MODERATION_UPDATE: 'MODERATION_UPDATE',
  SYSTEM: 'SYSTEM',
} as const;
export type NotificationType = (typeof NotificationType)[keyof typeof NotificationType];

export const ModerationActionType = {
  HIDE_LISTING: 'HIDE_LISTING',
  UNHIDE_LISTING: 'UNHIDE_LISTING',
  SUSPEND_ACCOUNT: 'SUSPEND_ACCOUNT',
  RESTORE_ACCOUNT: 'RESTORE_ACCOUNT',
  WARN_USER: 'WARN_USER',
  CHANGE_ROLE: 'CHANGE_ROLE',
  RESOLVE_REPORT: 'RESOLVE_REPORT',
  DISMISS_REPORT: 'DISMISS_REPORT',
  MANUAL_VERIFICATION: 'MANUAL_VERIFICATION',
  PROFILE_CORRECTION: 'PROFILE_CORRECTION',
  DELETE_ACCOUNT: 'DELETE_ACCOUNT',
} as const;
export type ModerationActionType = (typeof ModerationActionType)[keyof typeof ModerationActionType];

export function newId(): string {
  return `c${Date.now().toString(36)}${randomBytes(8).toString('hex')}`;
}
