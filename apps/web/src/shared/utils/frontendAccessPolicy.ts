import {
  ROLE_PERMISSIONS,
  hasClinicalAccess,
  type AuthUser,
  type Permission,
  type Role,
} from '@signacare/shared';

type RouteAccessRule = {
  allowedRoles?: readonly Role[];
  requiredAnyPermissions?: readonly Permission[];
  requireClinicalAccess?: boolean;
};

const ROUTE_ACCESS_RULES: Record<string, RouteAccessRule> = {
  '/power-settings': { allowedRoles: ['superadmin'] },
  '/org-settings': { allowedRoles: ['admin', 'superadmin'] },
  '/staff-assignments': { allowedRoles: ['admin', 'superadmin'] },
  '/audit': { allowedRoles: ['admin', 'superadmin', 'manager'] },
  '/manager-dashboard': { allowedRoles: ['admin', 'superadmin'] },
  '/reports': { requiredAnyPermissions: ['report:read'] },
  '/reports/compliance': { requiredAnyPermissions: ['report:read'] },
  '/clinical-notes': { requireClinicalAccess: true, requiredAnyPermissions: ['note:read'] },
  '/pathways': { requireClinicalAccess: true, requiredAnyPermissions: ['note:read'] },
  '/agentic-scribe': { requireClinicalAccess: true, requiredAnyPermissions: ['note:read'] },
};

const NON_CLINICAL_PATIENT_TABS = new Set<string>([
  'overview',
  'appointments',
  'billing',
]);

function normalizeRoutePath(path: string): string {
  const withLeadingSlash = path.startsWith('/') ? path : `/${path}`;
  const [withoutQuery] = withLeadingSlash.split('?');
  const trimmed = withoutQuery.replace(/\/+$/, '');
  return trimmed.length > 0 ? trimmed : '/';
}

export function getEffectivePermissions(user: AuthUser | null | undefined): Set<Permission> {
  if (!user) return new Set();

  if (Array.isArray(user.permissions) && user.permissions.length > 0) {
    return new Set(user.permissions);
  }

  return new Set(ROLE_PERMISSIONS[user.role] ?? []);
}

export function canAccessPermission(
  user: AuthUser | null | undefined,
  permission: Permission,
): boolean {
  return getEffectivePermissions(user).has(permission);
}

export function canAccessRoute(
  user: AuthUser | null | undefined,
  routePath: string,
): boolean {
  if (!user) return false;

  const normalizedPath = normalizeRoutePath(routePath);
  const rule = ROUTE_ACCESS_RULES[normalizedPath];
  if (!rule) return true;

  if (rule.allowedRoles && !rule.allowedRoles.includes(user.role)) {
    return false;
  }

  if (rule.requireClinicalAccess && !hasClinicalAccess(user.role)) {
    return false;
  }

  if (rule.requiredAnyPermissions && rule.requiredAnyPermissions.length > 0) {
    const permissions = getEffectivePermissions(user);
    const hasAtLeastOne = rule.requiredAnyPermissions.some((permission) => permissions.has(permission));
    if (!hasAtLeastOne) return false;
  }

  return true;
}

export function canAccessPatientTab(
  user: AuthUser | null | undefined,
  tabId: string,
): boolean {
  if (!user) return false;

  if (!hasClinicalAccess(user.role)) {
    return NON_CLINICAL_PATIENT_TABS.has(tabId);
  }

  return true;
}

export function firstAccessiblePatientTab(user: AuthUser | null | undefined): string {
  if (user && hasClinicalAccess(user.role) && canAccessPatientTab(user, 'summary')) {
    return 'summary';
  }
  return canAccessPatientTab(user, 'overview') ? 'overview' : 'appointments';
}
