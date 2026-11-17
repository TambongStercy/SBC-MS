/**
 * Admin modules and per-module access (Rufus, 2026-11-16).
 *
 * A staff account gets, per module, 'read' (sees the pages, changes nothing)
 * or 'write'; a module missing from its map is not visible at all. `admin` is
 * the super admin: every module in write, plus `staff` (managing the team),
 * which only a super admin ever holds.
 *
 * The gateway enforces this on every request (gateway-service
 * admin-access.middleware.ts holds the path → module table); the services only
 * check that the caller is admin-capable. Keep this list in sync with the
 * gateway and with admin-frontend-ms/src/lib/permissions.ts.
 */
export const ADMIN_MODULES = [
    'dashboard',       // Accueil, statistiques générales
    'members',         // Membres : liste, fiche, blocage, abonnements
    'partners',        // Partenaires
    'leaderboard',     // Classement, bonus du classement
    'finance',         // Transactions, transactions des comptes, analyse, ajustements de solde
    'payments',        // Paiements : récupération, problèmes fournisseurs, soldes passerelles
    'withdrawals',     // Retraits à valider, historique
    'payouts',         // Paiements directs (argent de SBC)
    'boutique',        // Produits, ventes flash
    'tombola',         // Tombola
    'impactChallenge', // Impact Challenge
    'sbclove',         // SBC Love
    'ads',             // SBC Ads Network (sauf preuves vidéo)
    'adsProofs',       // Vérifications vidéo des diffuseurs
    'events',          // SBC Event (billetterie, animation)
    'relance',         // Relance
    'notifications',   // Notifications, annonces push
    'communication',   // Chat, statuts
    'settings',        // Réglages, formations, stockage, événements communautaires
    'whatsapp',        // Connexion WhatsApp du serveur
    'staff',           // Équipe et droits : super admin uniquement
] as const;

export type AdminModule = typeof ADMIN_MODULES[number];
export type AccessLevel = 'read' | 'write';
export type AdminPermissions = Partial<Record<AdminModule, AccessLevel>>;

/** Modules a staff account can be given ('staff' is never delegated). */
export const DELEGABLE_MODULES = ADMIN_MODULES.filter(m => m !== 'staff');

export const isAdminModule = (m: unknown): m is AdminModule =>
    typeof m === 'string' && (ADMIN_MODULES as readonly string[]).includes(m);

/** Keeps only known modules (never 'staff') with a valid level. */
export function sanitizePermissions(input: unknown): AdminPermissions {
    const out: AdminPermissions = {};
    if (!input || typeof input !== 'object') return out;
    for (const [module, level] of Object.entries(input as Record<string, unknown>)) {
        if (!isAdminModule(module) || module === 'staff') continue;
        if (level === 'read' || level === 'write') out[module] = level;
    }
    return out;
}

/**
 * What a user may do in the admin, from their role. The two roles that came
 * before modules keep exactly what they had: withdrawal_admin → retraits,
 * moderator → preuves vidéo (scripts/convert-staff-roles.ts moves them to
 * `staff`).
 */
export function effectivePermissions(role: string | undefined, stored?: unknown): AdminPermissions {
    switch (role) {
        case 'admin':
            return Object.fromEntries(ADMIN_MODULES.map(m => [m, 'write'])) as AdminPermissions;
        case 'staff':
            return sanitizePermissions(stored);
        case 'withdrawal_admin':
            return { withdrawals: 'write' };
        case 'moderator':
            return { adsProofs: 'write' };
        default:
            return {};
    }
}
