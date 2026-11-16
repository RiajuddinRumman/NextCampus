import { SetMetadata } from '@nestjs/common';
import type { Role } from '../../database/schema';

export const IS_PUBLIC_KEY = 'scsp:isPublic';
export const REQUIRES_VERIFIED_STUDENT_KEY = 'scsp:requiresVerifiedStudent';
export const ROLES_KEY = 'scsp:roles';
export const ALLOW_SUSPENDED_KEY = 'scsp:allowSuspended';

export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const VerifiedStudent = () => SetMetadata(REQUIRES_VERIFIED_STUDENT_KEY, true);

export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

export const AllowSuspended = () => SetMetadata(ALLOW_SUSPENDED_KEY, true);
