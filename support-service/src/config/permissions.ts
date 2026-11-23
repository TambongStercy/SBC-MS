/**
 * Roles → permissions, exactly as CONTRACT.md §4. Every desk route checks one
 * of these server-side (requirePermission); a refusal is written to the audit.
 */

export const ROLES = [
    'support_agent', 'finance_agent', 'finance_manager', 'verifier', 'views_supervisor', 'support_admin', 'super_manager',
] as const;
/** Security plan Phase 5: at most this many agents may hold super_manager (1–2 named accounts). */
export const SUPER_MANAGER_MAX = 2;
export type Role = typeof ROLES[number];

export const ROLE_LABELS: Record<Role, string> = {
    support_agent: 'Agent support',
    finance_agent: 'Agent financier',
    finance_manager: 'Responsable financier',
    verifier: 'Vérificateur',
    views_supervisor: 'Superviseur des vérificateurs',
    support_admin: 'Administrateur du support',
    super_manager: 'Super responsable',
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
    // Security plan Phase 5.
    'risk.read', 'risk.decide', 'authenticator.reset.request', 'authenticator.reset.approve', 'approvals.override',
    // KYC level 3 (2026-11-22).
    'identity.review',
    'replay.read', 'assist.control',
] as const;
export type Permission = typeof PERMISSIONS[number];

const A = 'support_agent', FA = 'finance_agent', FM = 'finance_manager', V = 'verifier', VS = 'views_supervisor', SA = 'support_admin', SM = 'super_manager';

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
    // Security plan Phase 5. Fraud cases are handled by finance managers (decided); the
    // support administrator may read them. A support agent asks for an authenticator
    // reset (after ID + selfie), a finance manager approves it.
    'risk.read': [FM, SA],
    'risk.decide': [FM],
    'authenticator.reset.request': [A, SA],
    'authenticator.reset.approve': [FM],
    // super_manager: approves alone (no second approver, own requests included), with an
    // authenticator code and a written reason on each action, an instant alert to the
    // other managers, never on their own account or referral tree.
    'approvals.override': [SM],
    // KYC level 3 (decided 2026-11-22): any support agent reviews an ID document + selfie.
    // The verifiers (WhatsApp views only) are left out.
    'identity.review': [A, FA, FM, VS, SA],
    // Session replay (2026-11-23): a member's recordings and live screen, from the member card.
    'replay.read': [A, FA, FM, VS, SA],
    // Live assistance with remote control (2026-11-23): support administrators only. The member
    // still has to accept every control request, and sensitive screens refuse it.
    'assist.control': [SA],
};

// The super manager can do everything a finance manager can (plus approvals.override).
for (const roles of Object.values(MATRIX)) if (roles.includes(FM) && !roles.includes(SM)) roles.push(SM);

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
