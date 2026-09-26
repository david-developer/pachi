// Role ceilings do not implement the underlying business operations. A matching
// scoped grant, resource eligibility, purpose and audit are still required.
export const STAFF_PERMISSIONS = {
  SUPER_ADMIN: ['admin:permissions_manage', 'configuration:manage', 'recovery:manage'],
  VERIFICATION_OFFICER: ['provider:verify', 'organization:verify', 'evidence:read'],
  LISTING_MODERATOR: ['listing:moderate', 'listing:hide', 'listing:remove'],
  TRUST_SAFETY_MODERATOR: [
    'report:triage',
    'moderation:act',
    'review:moderate',
    'appeal:resolve',
    'user:restrict',
    'user:suspend',
    'evidence:read',
  ],
  SUPPORT_AGENT: ['user:read', 'recovery:escalate'],
  ANALYST: ['analytics:aggregate'],
} as const;
export type StaffRole = keyof typeof STAFF_PERMISSIONS;
export type StaffScope = {
  kind: 'platform' | 'region' | 'case';
  id: string;
  permissions: string[];
};
export class StaffAccessError extends Error {
  constructor(
    public readonly code:
      | 'AUTH_REQUIRED'
      | 'RESOURCE_SCOPE_DENIED'
      | 'STEP_UP_REQUIRED'
      | 'CONFIGURATION',
  ) {
    super(code);
  }
}
export function validStaffScope(role: string, value: unknown): value is StaffScope {
  if (!Object.hasOwn(STAFF_PERMISSIONS, role) || !value || typeof value !== 'object') return false;
  const s = value as StaffScope;
  if (
    !['platform', 'region', 'case'].includes(s.kind) ||
    typeof s.id !== 'string' ||
    !s.id ||
    s.id.length > 100
  )
    return false;
  if (s.kind === 'platform' && s.id !== 'pachi') return false;
  if (role === 'LISTING_MODERATOR' && s.kind === 'platform') return false;
  if (!Array.isArray(s.permissions) || !s.permissions.length) return false;
  const ceiling: readonly string[] = STAFF_PERMISSIONS[role as StaffRole];
  if (!s.permissions.every((p) => typeof p === 'string' && ceiling.includes(p))) return false;
  // Private evidence, support context and recovery always need a concrete case.
  if (
    s.permissions.some((p) =>
      [
        'evidence:read',
        'provider:verify',
        'organization:verify',
        'user:read',
        'recovery:manage',
        'recovery:escalate',
        'user:suspend',
        'user:restrict',
        'moderation:act',
        'review:moderate',
        'appeal:resolve',
      ].includes(p),
    ) &&
    s.kind !== 'case'
  )
    return false;
  if (s.permissions.includes('admin:permissions_manage') && s.kind !== 'platform') return false;
  return true;
}
export function requireStaffPermission(
  grants: { role: string; scope: StaffScope }[],
  permission: string,
  scope: { kind: StaffScope['kind']; id: string },
  authenticatedAt: Date,
  now: Date,
  sensitive = true,
): void {
  if (
    !grants.some(
      (g) =>
        validStaffScope(g.role, g.scope) &&
        g.scope.permissions.includes(permission) &&
        g.scope.kind === scope.kind &&
        g.scope.id === scope.id,
    )
  )
    throw new StaffAccessError('RESOURCE_SCOPE_DENIED');
  if (
    sensitive &&
    (now.getTime() - authenticatedAt.getTime() >= 15 * 60_000 || authenticatedAt > now)
  )
    throw new StaffAccessError('STEP_UP_REQUIRED');
}
