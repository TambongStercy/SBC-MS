/**
 * Which admin module an API call belongs to, and whether it reads or writes.
 * Mirrors user-service src/config/admin-modules.ts (the module list) and
 * admin-frontend-ms src/lib/permissions.ts (the menu). First match wins, so
 * specific paths come before their prefix.
 *
 * Paths without "/admin" are listed too: before 2026-11-16 several of them
 * (settings writes, storage, community events, WhatsApp, payouts) were open to
 * any signed-in member, or to anyone.
 */
export type AdminModule =
    | 'dashboard' | 'members' | 'partners' | 'leaderboard' | 'finance' | 'payments'
    | 'withdrawals' | 'payouts' | 'boutique' | 'tombola' | 'impactChallenge' | 'sbclove'
    | 'ads' | 'adsProofs' | 'events' | 'relance' | 'notifications' | 'communication'
    | 'settings' | 'whatsapp' | 'staff';

export type AccessLevel = 'read' | 'write';

/** 'self' = any staff account (its own access); null = not an admin call. */
export type RouteModule = AdminModule | 'self';

interface Rule {
    pattern: RegExp;
    /** 'public' = never an admin call, whatever the path says. */
    module: RouteModule | 'public';
    /** Only these methods are admin calls on this path (others pass through as before). */
    methods?: string[];
}

const WRITES = ['POST', 'PUT', 'PATCH', 'DELETE'];

const RULES: Rule[] = [
    // SBC Support authenticates its own desk (agent accounts, TOTP, CSRF): a
    // path such as /api/support/desk/.../admin must never fall into the staff gate.
    { pattern: /^\/api\/support(\/|$)/, module: 'public' },
    // --- user-service ---
    { pattern: /^\/api\/users\/admin\/me\/(access|security|backup-codes)$/, module: 'self' },
    { pattern: /^\/api\/users\/admin\/logout$/, module: 'self' },
    { pattern: /^\/api\/users\/admin\/staff(\/|$)/, module: 'staff' },
    { pattern: /^\/api\/users\/admin\/users\/[^/]+\/role$/, module: 'staff' },
    { pattern: /^\/api\/users\/admin\/fix-referrals$/, module: 'staff' },
    { pattern: /^\/api\/users\/sub-admins(\/|$)/, module: 'staff' },
    { pattern: /^\/api\/users\/admin\/users\/[^/]+\/(adjust-balance|cancel-activation-transfer)$/, module: 'finance' },
    { pattern: /^\/api\/users\/admin\/users(\/|$)/, module: 'members' },
    { pattern: /^\/api\/users\/admin\/partners(\/|$)/, module: 'partners' },
    { pattern: /^\/api\/users\/admin\/leaderboard(-bonus)?(\/|$)/, module: 'leaderboard' },
    // The Utilisateurs page's own counters.
    { pattern: /^\/api\/users\/admin\/stats\/user-summary$/, module: 'members' },
    { pattern: /^\/api\/users\/admin\/(dashboard|stats)(\/|$)/, module: 'dashboard' },
    // Security plan Phase 11: daily activity board and the lists behind it.
    { pattern: /^\/api\/users\/admin\/activity(\/|$)/, module: 'dashboard' },
    // Security plan Phase 3 rollout: authenticator adoption among members above 5,000 F.
    { pattern: /^\/api\/users\/admin\/security\/authenticator-adoption$/, module: 'dashboard' },
    // Security plan Phase 7: « Comptes dormants » (money held by accounts nobody uses).
    { pattern: /^\/api\/users\/admin\/dormant-accounts(\/|$)/, module: 'finance' },

    // --- payment-service ---
    { pattern: /^\/api\/payments\/admin\/withdrawals(\/|$)/, module: 'withdrawals' },
    { pattern: /^\/api\/payments\/admin\/stats(\/|$)/, module: 'dashboard' },
    { pattern: /^\/api\/payments\/admin\/transactions(\/|$)/, module: 'finance' },
    { pattern: /^\/api\/payments\/admin(\/|$)/, module: 'payments' },
    { pattern: /^\/api\/transactions\/admin(\/|$)/, module: 'finance' },
    { pattern: /^\/api\/withdrawals\/admin\/user(\/|$)/, module: 'withdrawals' },
    { pattern: /^\/api\/withdrawals(\/|$)/, module: 'payouts' },
    // Provider callbacks stay public (they carry their own verification).
    { pattern: /^\/api\/payouts\/webhooks(\/|$)/, module: 'public' },
    { pattern: /^\/api\/payouts(\/|$)/, module: 'payouts' },

    // --- notification-service ---
    { pattern: /^\/api\/relance\/admin(\/|$)/, module: 'relance' },
    { pattern: /^\/api\/notifications\/push\/admin(\/|$)/, module: 'notifications' },
    { pattern: /^\/api\/notifications\/(custom|templated|follow-up)(\/|$)/, module: 'notifications' },
    { pattern: /^\/api\/webhook\/(bounce-stats|cleanup-bounces)$/, module: 'notifications' },
    { pattern: /^\/api\/whatsapp(\/|$)/, module: 'whatsapp' },
    { pattern: /^\/api\/notifications\/whatsapp(\/|$)/, module: 'whatsapp' },

    // --- product / tombola / sbclove / ads / events ---
    { pattern: /^\/api\/(products|flash-sales)\/admin(\/|$)/, module: 'boutique' },
    { pattern: /^\/api\/tombolas\/admin(\/|$)/, module: 'tombola' },
    { pattern: /^\/api\/challenges\/admin(\/|$)/, module: 'impactChallenge' },
    { pattern: /^\/api\/sbclove\/admin(\/|$)/, module: 'sbclove' },
    { pattern: /^\/api\/advertising\/admin\/manual-verifications(\/|$)/, module: 'adsProofs' },
    { pattern: /^\/api\/advertising\/admin(\/|$)/, module: 'ads' },
    { pattern: /^\/api\/tickets\/admin(\/|$)/, module: 'events' },

    // --- settings-service (members still read settings, formations, events and upload files) ---
    { pattern: /^\/api\/settings\/gateway-balances(\/|$)/, module: 'payments' },
    { pattern: /^\/api\/settings\/stats\/admin-balance$/, module: 'dashboard' },
    { pattern: /^\/api\/settings\/storage(\/|$)/, module: 'settings' },
    { pattern: /^\/api\/settings\/event-commissions$/, module: 'events', methods: WRITES },
    { pattern: /^\/api\/settings\/(logo|terms-pdf|presentation-video|presentation-pdf)$/, module: 'settings', methods: WRITES },
    { pattern: /^\/api\/settings\/formations(\/|$)/, module: 'settings', methods: WRITES },
    { pattern: /^\/api\/settings\/?$/, module: 'settings', methods: WRITES },
    { pattern: /^\/api\/events(\/|$)/, module: 'settings', methods: WRITES },
];

/** POST calls that only read (previews, audience counts). */
const READ_ONLY_POSTS: RegExp[] = [
    /^\/api\/notifications\/push\/admin\/audience$/,
    /^\/api\/relance\/admin\/messages\/preview$/,
    /^\/api\/relance\/admin\/sms-templates\/preview$/,
    // Builds a CSV of what the list already shows.
    /^\/api\/users\/admin\/dormant-accounts\/export$/,
];

const ADMIN_PATH = /\/admin(\/|$)/i;

export interface AdminRoute { module: RouteModule; level: AccessLevel }

/**
 * The admin module and level of a call, or null when it is not an admin call.
 * Any other path containing "/admin" is treated as super-admin only ('staff'),
 * so a new admin route is closed to staff until it is mapped here.
 */
export function resolveAdminRoute(method: string, path: string): AdminRoute | null {
    const m = method.toUpperCase();
    if (m === 'OPTIONS') return null;
    let module: RouteModule | 'public' | undefined;
    for (const rule of RULES) {
        if (!rule.pattern.test(path)) continue;
        if (rule.methods && !rule.methods.includes(m)) return null;
        module = rule.module;
        break;
    }
    if (module === 'public') return null;
    if (module === undefined) {
        if (!ADMIN_PATH.test(path)) return null;
        module = 'staff';
    }
    const reads = m === 'GET' || m === 'HEAD' || (m === 'POST' && READ_ONLY_POSTS.some(r => r.test(path)));
    return { module, level: reads ? 'read' : 'write' };
}

export function allows(permissions: Partial<Record<AdminModule, AccessLevel>>, route: AdminRoute): boolean {
    if (route.module === 'self') return true;
    const granted = permissions[route.module];
    return granted === 'write' || (granted === 'read' && route.level === 'read');
}
