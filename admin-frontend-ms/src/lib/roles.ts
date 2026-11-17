/**
 * Role names, for display only. What an account may open comes from its
 * per-module permissions (lib/permissions.ts), not from its role.
 */
export const ROLE_LABEL: Record<string, string> = {
    admin: 'Super admin',
    staff: 'Équipe',
    withdrawal_admin: 'Retraits (ancien rôle)',
    moderator: 'Vérifications vidéo (ancien rôle)',
    tester: 'Testeur',
    user: 'Membre',
};

/** The role inside the session token (what it was when the admin signed in). */
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
