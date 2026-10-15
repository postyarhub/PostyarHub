/**
 * Central authorization matrix (§115, §95). Hiding UI is never authorization:
 * every privileged route declares its permission here and the hook enforces it.
 */
export type Permission =
  | 'admin.access'
  | 'admin.users.manage'
  | 'admin.plans.manage'
  | 'admin.settings.manage'
  | 'admin.payments.review'
  | 'admin.broadcast'
  | 'support.tickets.any';

const ROLE_PERMISSIONS: Record<'SUPER_ADMIN' | 'SUPPORT' | 'USER', Permission[]> = {
  SUPER_ADMIN: [
    'admin.access', 'admin.users.manage', 'admin.plans.manage',
    'admin.settings.manage', 'admin.payments.review', 'admin.broadcast', 'support.tickets.any',
  ],
  SUPPORT: ['admin.access', 'support.tickets.any'],
  USER: [],
};

export function roleHasPermission(role: 'SUPER_ADMIN' | 'SUPPORT' | 'USER', permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}
