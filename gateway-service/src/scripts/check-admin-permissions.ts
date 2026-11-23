/**
 * Per-module admin access at the gateway (admin-routes.ts + admin-allowlist.middleware.ts).
 * No network: user-service's admin-access answer is stubbed.
 *
 *   npx ts-node --transpile-only src/scripts/check-admin-permissions.ts
 * (signs with the gateway's own JWT secret; the allowlist is set below)
 */
import crypto from 'crypto';
import config from '../config';
import { resolveAdminRoute } from '../api/middleware/admin-routes';
import { adminAllowlist, clearAccessCache, normalizePath } from '../api/middleware/admin-allowlist.middleware';

// Read at call time by the middleware, so setting it here is enough.
process.env.ADMIN_ALLOWLIST = 'a1,s1,s2,s3,w1';

let failed = 0;
const check = (label: string, ok: boolean) => {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
    if (!ok) failed++;
};

// --- route table ---
const route = (m: string, p: string) => resolveAdminRoute(m, normalizePath(p));
const is = (m: string, p: string, module: string | null, level?: string) => {
    const r = route(m, p);
    check(`${m} ${p} → ${module ?? 'not admin'}${level ? ' ' + level : ''}`,
        module === null ? r === null : (!!r && r.module === module && (!level || r.level === level)));
};
is('GET', '/api/users/admin/users?page=2', 'members', 'read');
// SBC Impact Challenge v2 (event-service): its own module, not « events »; member and public paths are not admin.
is('GET', '/api/tickets/impact/admin/editions', 'impactChallenge', 'read');
is('POST', '/api/tickets/impact/admin/candidates/abc/disqualify', 'impactChallenge', 'write');
is('GET', '/api/tickets/impact/me', null);
is('GET', '/api/tickets/impact/public/current', null);
is('PUT', '/api/users/admin/users/abc', 'members', 'write');
is('PATCH', '/api/users/admin/users/abc/role', 'staff', 'write');
is('POST', '/api/users/admin/users/abc/adjust-balance', 'finance', 'write');
is('GET', '/api/users/admin/me/access', 'self', 'read');
is('GET', '/api/users/admin/stats/user-summary', 'members', 'read');
is('GET', '/api/users/admin/stats/monthly-activity', 'dashboard', 'read');
is('GET', '/api/users/admin/activity', 'dashboard', 'read');
is('GET', '/api/users/admin/activity/list', 'dashboard', 'read');
is('GET', '/api/users/admin/dormant-accounts/summary', 'finance', 'read');
is('GET', '/api/users/admin/dormant-accounts', 'finance', 'read');
is('POST', '/api/users/admin/dormant-accounts/export', 'finance', 'read');
is('GET', '/api/users/admin/dormant-accounts/exports/abc/download', 'finance', 'read');
is('POST', '/api/users/admin/dormant-accounts/abc/checked', 'finance', 'write');
is('POST', '/api/users/admin/dormant-accounts/abc/freeze-request', 'finance', 'write');
// Phase 7 part 2: réactivation. Text read/preview = finance read; send/cancel = finance write;
// editing and approving the text = super admin only.
is('GET', '/api/users/admin/dormant-accounts/reactivation/text', 'finance', 'read');
is('PUT', '/api/users/admin/dormant-accounts/reactivation/text/draft', 'staff', 'write');
is('POST', '/api/users/admin/dormant-accounts/reactivation/text/approve', 'staff', 'write');
is('POST', '/api/users/admin/dormant-accounts/reactivation/preview', 'finance', 'read');
is('GET', '/api/users/admin/dormant-accounts/reactivation/campaigns', 'finance', 'read');
is('POST', '/api/users/admin/dormant-accounts/reactivation/campaigns', 'finance', 'write');
is('POST', '/api/users/admin/dormant-accounts/reactivation/campaigns/abc/cancel', 'finance', 'write');
is('PUT', '/api/users/admin/staff/abc', 'staff', 'write');
is('POST', '/api/users/sub-admins', 'staff', 'write');
is('GET', '/api/payments/admin/withdrawals/pending', 'withdrawals', 'read');
is('POST', '/api/payments/admin/withdrawals/x/approve', 'withdrawals', 'write');
is('POST', '/api/withdrawals/admin/direct', 'payouts', 'write');
is('POST', '/api/payouts/initiate', 'payouts', 'write');
is('POST', '/api/payouts/webhooks/cinetpay', null);
is('POST', '/api/notifications/push/admin/audience', 'notifications', 'read');
is('POST', '/api/notifications/push/admin/announce', 'notifications', 'write');
is('POST', '/api/relance/admin/messages/preview', 'relance', 'read');
is('GET', '/api/whatsapp/qr', 'whatsapp', 'read');
// SBC Support authenticates its own desk: never caught by the admin gate.
is('POST', '/api/support/desk/auth/login', null);
is('GET', '/api/support/desk/tickets', null);
is('POST', '/api/support/desk/agents/abc/admin', null);
is('GET', '/api/support/desk/admin', null);
is('GET', '/api/Support/Desk/../desk/admin', null);
is('GET', '/api/support/me/kb/articles/admin', null);
is('POST', '/api/whatsapp/logout', 'whatsapp', 'write');
is('GET', '/api/advertising/admin/manual-verifications', 'adsProofs', 'read');
is('GET', '/api/advertising/admin/campaigns', 'ads', 'read');
is('PUT', '/api/settings', 'settings', 'write');
is('GET', '/api/settings', null);
is('POST', '/api/settings/files/upload', null);
is('GET', '/api/settings/formations', null);
is('POST', '/api/settings/formations', 'settings', 'write');
is('GET', '/api/settings/gateway-balances', 'payments', 'read');
is('POST', '/api/settings/storage/check', 'settings', 'write');
is('GET', '/api/events', null);
is('DELETE', '/api/events/e1', 'settings', 'write');
is('GET', '/api/users/me', null);
is('GET', '/api/something/admin/new-thing', 'staff', 'read'); // unmapped admin path: super admin only
// Paths dressed up to slip past the table
is('POST', '/api/WhatsApp/logout', 'whatsapp', 'write');
is('PATCH', '/api/users//admin/users/abc/role', 'staff', 'write');
is('PATCH', '/api/users/me/../admin/users/abc/role', 'staff', 'write');
is('PATCH', '/api/users/%61dmin/users/abc/role', 'staff', 'write');
is('OPTIONS', '/api/users/admin/users', null);

// --- middleware ---
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
/** asid: the admin session (admin sign-in); null = a member-app token. */
const sign = (userId: string, role: string, asid: string | null = 'live-session') => {
    const h = b64({ alg: 'HS256', typ: 'JWT' });
    const p = b64({ userId, id: userId, role, exp: Math.floor(Date.now() / 1000) + 3600, ...(asid ? { asid } : {}) });
    const s = crypto.createHmac('sha256', config.jwt.secret).update(`${h}.${p}`).digest('base64url');
    return `${h}.${p}.${s}`;
};

const ACCESS: Record<string, unknown> = {
    a1: { role: 'admin', blocked: false, permissions: { members: 'write', staff: 'write', whatsapp: 'write' } },
    s1: { role: 'staff', blocked: false, permissions: { members: 'read', withdrawals: 'write' } },
    s2: { role: 'staff', blocked: false, permissions: {} },
    s3: { role: 'staff', blocked: true, permissions: {} },
    w1: { role: 'withdrawal_admin', blocked: false, permissions: { withdrawals: 'write' } },
};
let lookups = 0;
let userServiceDown = false;
let endedRevoked = false;
(globalThis as any).fetch = async (url: string) => {
    lookups++;
    if (userServiceDown) throw new Error('ECONNREFUSED');
    const id = decodeURIComponent(url.split('/internal/')[1].split('/')[0]);
    const sid = new URL(url, 'http://x').searchParams.get('sid');
    const base = ACCESS[id] as Record<string, unknown> | undefined;
    const data = base && { ...base, session: sid === 'live-session' ? 'active' : sid === 'ended-session' && endedRevoked ? 'revoked' : sid === 'ended-session' ? 'active' : 'missing' };
    return { ok: !!data, status: data ? 200 : 404, json: async () => ({ success: true, data }) };
};

const call = async (method: string, url: string, token?: string): Promise<number> => {
    let status = 0;
    const req: any = { method, originalUrl: url, headers: token ? { authorization: `Bearer ${token}` } : {}, ip: '127.0.0.1' };
    const res: any = { status(code: number) { status = code; return this; }, json() { return this; } };
    await adminAllowlist(req, res, () => { status = 200; });
    return status;
};

(async () => {
    const t = (id: string, role: string) => sign(id, role);
    check('no token on an admin path → 403', await call('GET', '/api/users/admin/users') === 403);
    check('service secret passes', await call('POST', '/api/payouts/initiate', config.services.serviceSecret) === 200);
    check('member path is not touched', await call('GET', '/api/users/me', t('zz', 'user')) === 200);
    check('not allowlisted admin → 403', await call('GET', '/api/users/admin/users', t('zz', 'admin')) === 403);
    check('super admin passes a write', await call('POST', '/api/whatsapp/logout', t('a1', 'admin')) === 200);
    check('staff: read module, GET → 200', await call('GET', '/api/users/admin/users', t('s1', 'staff')) === 200);
    check('staff: read module, PUT → 403', await call('PUT', '/api/users/admin/users/x', t('s1', 'staff')) === 403);
    check('staff: write module, POST → 200', await call('POST', '/api/payments/admin/withdrawals/x/approve', t('s1', 'staff')) === 200);
    check('staff: other module → 403', await call('GET', '/api/sbclove/admin/profiles', t('s1', 'staff')) === 403);
    check('staff: own access always readable', await call('GET', '/api/users/admin/me/access', t('s2', 'staff')) === 200);
    check('staff cannot change a role', await call('PATCH', '/api/users/admin/users/x/role', t('s1', 'staff')) === 403);
    check('staff cannot reach unmapped admin paths', await call('GET', '/api/foo/admin/bar', t('s1', 'staff')) === 403);
    check('blocked staff → 403', await call('GET', '/api/users/admin/me/access', t('s3', 'staff')) === 403);
    check('withdrawal_admin keeps withdrawals', await call('GET', '/api/payments/admin/withdrawals/pending', t('w1', 'withdrawal_admin')) === 200);
    check('withdrawal_admin loses the Ads admin', await call('GET', '/api/advertising/admin/campaigns', t('w1', 'withdrawal_admin')) === 403);
    check('member writing settings → 403', await call('PUT', '/api/settings', t('zz', 'user')) === 403);
    check('anyone calling WhatsApp logout → 403', await call('POST', '/api/whatsapp/logout') === 403);

    clearAccessCache(); lookups = 0;
    await call('GET', '/api/users/admin/users', t('s1', 'staff'));
    await call('GET', '/api/users/admin/users', t('s1', 'staff'));
    check('access cached between calls (one lookup)', lookups === 1);

    // --- admin sessions (authenticator sign-in, 2026-11-19) ---
    clearAccessCache();
    check('member-app token of a super admin (no admin session) → 401', await call('GET', '/api/users/admin/users', sign('a1', 'admin', null)) === 401);
    check('unknown admin session → 401', await call('GET', '/api/users/admin/users', sign('a1', 'admin', 'forged')) === 401);
    check('member-app token still works on member paths', await call('GET', '/api/users/me', sign('a1', 'admin', null)) === 200);
    check('sign-in steps need no token', await call('POST', '/api/users/admin/login/totp') === 200 && await call('POST', '/api/users/admin/login/enroll/confirm') === 200);
    check('own security page readable by any staff session', await call('GET', '/api/users/admin/me/security', t('s2', 'staff')) === 200);
    check('reset of an authenticator is super admin only', await call('POST', '/api/users/admin/staff/x/reset-authenticator', t('s1', 'staff')) === 403);
    const ended = sign('a1', 'admin', 'ended-session');
    check('open session passes', await call('GET', '/api/users/admin/users', ended) === 200);
    check('sign-out passes', await call('POST', '/api/users/admin/logout', ended) === 200);
    endedRevoked = true;
    check('after sign-out the same token is refused at once (cache dropped)', await call('GET', '/api/users/admin/users', ended) === 401);

    clearAccessCache(); userServiceDown = true;
    check('user-service down → 503, never open', await call('GET', '/api/users/admin/users', t('s1', 'staff')) === 503);
    userServiceDown = false;

    console.log(failed ? `\n${failed} check(s) FAILED` : '\nall checks passed');
    process.exit(failed ? 1 : 0);
})();
