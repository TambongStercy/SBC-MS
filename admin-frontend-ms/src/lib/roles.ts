/**
 * Who can open what. The server is the real gate; this keeps people out of
 * screens whose calls would fail for them anyway, instead of only hiding the
 * links in the menu.
 */
export type AdminRole = 'admin' | 'withdrawal_admin' | 'moderator';

export const ROLE_LABEL: Record<string, string> = {
    admin: 'Administrateur',
    withdrawal_admin: 'Admin retraits',
    moderator: 'Modérateur',
    tester: 'Testeur',
    user: 'Membre',
};

/** The role inside the session token — what the server will judge requests by. */
export function roleFromToken(token: string | null): string | null {
    if (!token) return null;
    try {
        const part = token.split('.')[1];
        const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
        const payload = JSON.parse(json);
        return typeof payload.role === 'string' ? payload.role : null;
    } catch {
        return null;
    }
}

/** Paths a limited role may open ('/' exactly, others as prefixes). Admins open everything. */
const ALLOWED: Record<string, string[]> = {
    withdrawal_admin: ['/', '/a-traiter/retraits', '/argent', '/withdrawals/approvals', '/withdrawals/history',
        '/fix-moneyfusion-withdrawals', '/fix-cinetpay-withdrawals', '/plus'],
    moderator: ['/', '/a-traiter/verifications', '/plus'],
};

export const HOME_FOR: Record<string, string> = {
    withdrawal_admin: '/',
    moderator: '/',
};

export function canOpen(role: string | null, path: string): boolean {
    // Anyone signed in can sign out (and an unknown role is sent there).
    if (path === '/logout') return true;
    if (role === 'admin') return true;
    const allowed = role ? ALLOWED[role] : undefined;
    if (!allowed) return false;
    return allowed.some(p => (p === '/' ? path === '/' : path === p || path.startsWith(p + '/')));
}
