/**
 * Roles and permissions of SBC Support (CONTRACT.md §4). The server checks
 * every route; the app only uses these to show what an agent may do. The
 * agent's own `permissions` (from /desk/auth/me) are the truth; the role table
 * is the fallback when a response omits them, and the reference for tests.
 */

export const PERMISSIONS = [
  'members.read',
  'members.read.full',
  'members.contact.request',
  'members.contact.approve',
  'tickets.read',
  'tickets.reply',
  'tickets.assign',
  'activation.check',
  'activation.manual.request',
  'activation.manual.approve',
  'finance.read',
  'finance.recheck',
  'cases.work',
  'finance.regularize.request',
  'finance.regularize.approve',
  'views.verify',
  'views.supervise',
  'kb.edit',
  'kb.publish',
  'templates.manage',
  'reports.read',
  'export',
  'analytics.read',
  'errors.manage',
  'activity.read',
  // Security plan Phase 5.
  'risk.read',
  'risk.decide',
  'authenticator.reset.request',
  'authenticator.reset.approve',
  'approvals.override',
  // KYC level 3 (2026-11-22).
  'identity.review',
  // Session replay and live assistance (2026-11-23).
  'replay.read',
  'assist.control',
  'agents.manage',
  'settings.manage',
  'audit.read',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const ROLES = ['support_agent', 'finance_agent', 'finance_manager', 'verifier', 'views_supervisor', 'support_admin', 'super_manager'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = {
  support_agent: 'Agent support',
  finance_agent: 'Agent financier',
  finance_manager: 'Responsable financier',
  verifier: 'Vérificateur',
  views_supervisor: 'Superviseur des vérifications',
  support_admin: 'Administrateur du support',
  super_manager: 'Super responsable',
};

export const roleLabel = (r: string) => ROLE_LABEL[r as Role] ?? r;

/** CONTRACT.md §4, column by column. */
export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  support_agent: [
    'members.read', 'members.contact.request', 'tickets.read', 'tickets.reply',
    'activation.check', 'activation.manual.request', 'kb.edit', 'activity.read', 'authenticator.reset.request', 'identity.review',
    'replay.read', 'assist.control',
  ],
  finance_agent: [
    'members.read', 'tickets.read', 'tickets.reply', 'activation.check', 'activation.manual.request',
    'finance.read', 'finance.recheck', 'cases.work', 'finance.regularize.request', 'reports.read', 'activity.read', 'identity.review',
    'replay.read',
  ],
  finance_manager: [
    'members.read', 'members.read.full', 'members.contact.approve', 'tickets.read', 'tickets.reply', 'tickets.assign',
    'activation.check', 'activation.manual.request', 'activation.manual.approve',
    'finance.read', 'finance.recheck', 'cases.work', 'finance.regularize.request', 'finance.regularize.approve',
    'kb.edit', 'kb.publish', 'templates.manage', 'reports.read', 'export', 'activity.read',
    'risk.read', 'risk.decide', 'authenticator.reset.approve', 'identity.review', 'replay.read',
  ],
  verifier: ['views.verify'],
  views_supervisor: [
    'members.read', 'tickets.read', 'tickets.reply', 'tickets.assign', 'views.verify', 'views.supervise',
    'kb.edit', 'kb.publish', 'templates.manage', 'reports.read', 'export', 'activity.read', 'identity.review',
    'replay.read',
  ],
  support_admin: [
    'members.read', 'members.read.full', 'members.contact.request', 'members.contact.approve',
    'tickets.read', 'tickets.reply', 'tickets.assign', 'activation.check', 'activation.manual.request', 'activation.manual.approve',
    'finance.read', 'finance.recheck', 'cases.work', 'views.supervise', 'kb.edit', 'kb.publish', 'templates.manage',
    'reports.read', 'export', 'analytics.read', 'errors.manage', 'activity.read', 'agents.manage', 'settings.manage', 'audit.read',
    'risk.read', 'authenticator.reset.request', 'identity.review', 'replay.read', 'assist.control',
  ],
  super_manager: [], // filled just below
};
// The super manager holds every finance manager permission, plus approving alone.
ROLE_PERMISSIONS.super_manager = [...ROLE_PERMISSIONS.finance_manager, 'approvals.override'];

/** Union of the permissions of several roles (unknown roles give nothing). */
export function permissionsForRoles(roles: readonly string[]): Permission[] {
  const set = new Set<Permission>();
  for (const r of roles) for (const p of ROLE_PERMISSIONS[r as Role] ?? []) set.add(p);
  return [...set];
}

export type PermissionSet = ReadonlySet<string>;

export const hasAll = (have: PermissionSet, need: readonly Permission[]) => need.every(p => have.has(p));
export const hasAny = (have: PermissionSet, need: readonly Permission[]) => need.some(p => have.has(p));

/** Approval permissions, by kind of request: who may decide each one. */
export const APPROVE_PERMISSIONS: Permission[] = ['members.contact.approve', 'activation.manual.approve', 'finance.regularize.approve'];
export const REQUEST_PERMISSIONS: Permission[] = ['members.contact.request', 'activation.manual.request', 'finance.regularize.request'];
