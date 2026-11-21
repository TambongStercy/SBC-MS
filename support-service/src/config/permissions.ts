/**
 * Roles → permissions, exactly as CONTRACT.md §4. Every desk route checks one
 * of these server-side (requirePermission); a refusal is written to the audit.
 */

export const ROLES = [
    'support_agent', 'finance_agent', 'finance_manager', 'verifier', 'views_supervisor', 'support_admin',
] as const;
export type Role = typeof ROLES[number];

export const ROLE_LABELS: Record<Role, string> = {
    support_agent: 'Agent support',
    finance_agent: 'Agent financier',
    finance_manager: 'Responsable financier',
    verifier: 'Vérificateur',
    views_supervisor: 'Superviseur des vérificateurs',
    support_admin: 'Administrateur du support',
};

export const PERMISSIONS = [
    'members.read', 'members.read.full', 'members.contact.request', 'members.contact.approve',
    'tickets.read', 'tickets.reply', 'tickets.assign',
    'activation.check', 'activation.manual.request', 'activation.manual.approve',
    'finance.read', 'finance.recheck', 'cases.work',
    'finance.regularize.request', 'finance.regularize.approve',
    'views.verify', 'views.supervise',
    'kb.edit', 'kb.publish', 'templates.manage',
    'reports.read', 'export', 'analytics.read', 'errors.manage', 'activity.read',
    'agents.manage', 'settings.manage', 'audit.read',
] as const;
export type Permission = typeof PERMISSIONS[number];

const A = 'support_agent', FA = 'finance_agent', FM = 'finance_manager', V = 'verifier', VS = 'views_supervisor', SA = 'support_admin';

const MATRIX: Record<Permission, Role[]> = {
    'members.read': [A, FA, FM, VS, SA],
    'members.read.full': [FM, SA],
    'members.contact.request': [A, SA],
    'members.contact.approve': [FM, SA],
    'tickets.read': [A, FA, FM, VS, SA],
    'tickets.reply': [A, FA, FM, VS, SA],
    'tickets.assign': [FM, VS, SA],
    'activation.check': [A, FA, FM, SA],
    'activation.manual.request': [A, FA, FM, SA],
    'activation.manual.approve': [FM, SA],
    'finance.read': [FA, FM, SA],
    'finance.recheck': [FA, FM, SA],
    'cases.work': [FA, FM, SA],
    'finance.regularize.request': [FA, FM],
    'finance.regularize.approve': [FM],
    'views.verify': [V, VS],
    'views.supervise': [VS, SA],
    'kb.edit': [A, FM, VS, SA],
    'kb.publish': [FM, VS, SA],
    'templates.manage': [FM, VS, SA],
    'reports.read': [FA, FM, VS, SA],
    'export': [FM, VS, SA],
    // Analytics and technical errors: the support administrator.
    'analytics.read': [SA],
    // Security plan Phase 11: the day's activity panel, filtered to the agent's countries.
    'activity.read': [A, FA, FM, VS, SA],
    'errors.manage': [SA],
    'agents.manage': [SA],
    'settings.manage': [SA],
    'audit.read': [SA],
};

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = ROLES.reduce((acc, role) => {
    acc[role] = PERMISSIONS.filter((p) => MATRIX[p].includes(role));
    return acc;
}, {} as Record<Role, Permission[]>);

export function permissionsFor(roles: readonly string[]): Permission[] {
    const set = new Set<Permission>();
    for (const r of roles) for (const p of ROLE_PERMISSIONS[r as Role] ?? []) set.add(p);
    return PERMISSIONS.filter((p) => set.has(p));
}

export function hasPermission(roles: readonly string[], perm: Permission): boolean {
    return roles.some((r) => (ROLE_PERMISSIONS[r as Role] ?? []).includes(perm));
}

export const isRole = (r: unknown): r is Role => typeof r === 'string' && (ROLES as readonly string[]).includes(r);
