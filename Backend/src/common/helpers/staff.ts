import { Role } from '../../database/schema';
import type { AuthUser } from '../../modules/auth/session.service';

export interface StaffActor {
  id: string;
  role: Role;
}

export function toStaffActor(user: AuthUser): StaffActor {
  return { id: user.id, role: user.role };
}

export function isStaff(role?: Role): boolean {
  return role === Role.MODERATOR || role === Role.ADMIN;
}

export function isAdmin(role?: Role): boolean {
  return role === Role.ADMIN;
}
