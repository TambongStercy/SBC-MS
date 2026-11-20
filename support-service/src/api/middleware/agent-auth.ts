import { Request, Response, NextFunction, CookieOptions } from 'express';
import config from '../../config';
import { Agent } from '../../database/models/agent.model';
import { hasPermission, Permission, permissionsFor } from '../../config/permissions';
import { loadActiveSession, verifyAccess, IssuedSession } from '../../services/auth/session.service';
import { consumeReauth } from '../../services/auth/agent-auth.service';
import { auditSafe } from '../../services/audit.service';
import { randomToken, secretEquals } from '../../utils/crypto';
import { clientIp, userAgent } from '../../utils/client-ip';
import { AppError, forbidden, unauthorized } from '../../utils/errors';
import { requestContext } from '../../utils/request-context';

export interface DeskAgent {
    id: string;
    sid: string;
    name: string;
    email: string;
    roles: string[];
    permissions: Permission[];
}

export interface DeskRequest extends Request { agent?: DeskAgent }

export const agentOf = (req: Request): DeskAgent => {
    const a = (req as DeskRequest).agent;
    if (!a) throw unauthorized();
    return a;
};

/** Actor block for the audit log. */
export const actorOf = (req: Request) => {
    const a = agentOf(req);
    return { type: 'agent' as const, id: a.id, name: a.name, roles: a.roles };
};

export const reqCtx = (req: Request) => ({ ip: clientIp(req), userAgent: userAgent(req) });

const baseCookie = (): CookieOptions => ({ httpOnly: true, secure: config.auth.cookieSecure, sameSite: 'strict' });

export function setCsrfCookie(res: Response, token = randomToken(24)): string {
    res.cookie(config.cookies.csrf, token, { ...baseCookie(), httpOnly: false, path: '/', maxAge: config.auth.absoluteTimeoutMs });
    return token;
}

export function setSessionCookies(res: Response, s: IssuedSession): void {
    res.cookie(config.cookies.access, s.accessToken, { ...baseCookie(), path: config.cookies.accessPath, maxAge: config.auth.accessTtlSec * 1000 });
    res.cookie(config.cookies.refresh, s.refreshToken, { ...baseCookie(), path: config.cookies.refreshPath, maxAge: config.auth.absoluteTimeoutMs });
    setCsrfCookie(res, s.csrfToken);
}

export function setRefreshCookie(res: Response, refreshToken: string): void {
    res.cookie(config.cookies.refresh, refreshToken, { ...baseCookie(), path: config.cookies.refreshPath, maxAge: config.auth.absoluteTimeoutMs });
}

export function clearSessionCookies(res: Response): void {
    res.clearCookie(config.cookies.access, { ...baseCookie(), path: config.cookies.accessPath });
    res.clearCookie(config.cookies.refresh, { ...baseCookie(), path: config.cookies.refreshPath });
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function originAllowed(req: Request): boolean {
    const origin = req.header('origin');
    if (origin) return config.allowedOrigins.includes(origin.replace(/\/+$/, ''));
    // Some browsers omit Origin on same-origin requests; fall back to Referer.
    const referer = req.header('referer');
    if (!referer) return false;
    try {
        return config.allowedOrigins.includes(new URL(referer).origin);
    } catch {
        return false;
    }
}

/**
 * CSRF for the whole desk: on every non-GET, the Origin must be ours and the
 * x-csrf-token header must equal the readable sbc_sup_csrf cookie (double
 * submit). A GET hands out the cookie when it is missing.
 */
export function csrfProtection(req: Request, res: Response, next: NextFunction): void {
    const cookieToken = req.cookies?.[config.cookies.csrf] as string | undefined;
    if (SAFE_METHODS.has(req.method)) {
        if (!cookieToken) setCsrfCookie(res);
        return next();
    }
    if (!originAllowed(req)) {
        auditSafe({ actor: { type: 'anonymous' }, action: 'security.origin_refused', result: 'denied', meta: { method: req.method, path: req.baseUrl + req.path, origin: req.header('origin') || null }, ip: clientIp(req), userAgent: userAgent(req) });
        return next(forbidden('Origine de la requête refusée.', 'ORIGIN_REFUSED'));
    }
    const header = req.header('x-csrf-token');
    if (!cookieToken || !header || !secretEquals(header, cookieToken)) {
        auditSafe({ actor: { type: 'anonymous' }, action: 'security.csrf_refused', result: 'denied', meta: { method: req.method, path: req.baseUrl + req.path }, ip: clientIp(req), userAgent: userAgent(req) });
        return next(forbidden('Jeton de sécurité manquant ou invalide. Rechargez la page.', 'CSRF_REFUSED'));
    }
    next();
}

/**
 * Agent session from the httpOnly access cookie only. A bearer token (a member
 * JWT, say) is ignored, and anything not signed with SUPPORT_JWT_SECRET for
 * aud=sbc-support is refused. The server session must be live (not revoked,
 * not idle > 30 min, not older than 12 h) and the agent active.
 */
export async function requireAgent(req: Request, _res: Response, next: NextFunction): Promise<void> {
    try {
        const claims = verifyAccess(req.cookies?.[config.cookies.access]);
        if (!claims) throw unauthorized();
        const session = await loadActiveSession(claims.sid, claims.sub);
        if (!session) throw unauthorized();
        const agent = await Agent.findById(claims.sub, { email: 1, name: 1, roles: 1, status: 1 }).lean();
        if (!agent || agent.status !== 'active') throw unauthorized();
        // Roles come from the database, not the token: a role change applies at once.
        (req as DeskRequest).agent = {
            id: String(agent._id), sid: claims.sid, name: agent.name, email: agent.email, roles: agent.roles,
            permissions: permissionsFor(agent.roles),
        };
        const store = requestContext.getStore();
        if (store) store.actor = `${agent._id}|${agent.roles[0] ?? 'none'}`;
        next();
    } catch (err) {
        next(err);
    }
}

/** Every listed permission is required. Refusals are audited. */
export function requirePermission(...perms: Permission[]) {
    return (req: Request, _res: Response, next: NextFunction): void => {
        const agent = (req as DeskRequest).agent;
        if (!agent) return next(unauthorized());
        const missing = perms.filter((p) => !hasPermission(agent.roles, p));
        if (missing.length === 0) return next();
        auditSafe({
            actor: { type: 'agent', id: agent.id, name: agent.name, roles: agent.roles }, action: 'access.denied', result: 'denied',
            meta: { method: req.method, path: req.baseUrl + req.path, missing }, ip: clientIp(req), userAgent: userAgent(req),
        });
        next(forbidden());
    };
}

/** Same check inside a handler (permission depends on the object). */
export function assertPermission(req: Request, perm: Permission): void {
    const agent = agentOf(req);
    if (hasPermission(agent.roles, perm)) return;
    auditSafe({
        actor: { type: 'agent', id: agent.id, name: agent.name, roles: agent.roles }, action: 'access.denied', result: 'denied',
        meta: { method: req.method, path: req.baseUrl + req.path, missing: [perm] }, ip: clientIp(req), userAgent: userAgent(req),
    });
    throw forbidden();
}

/** Sensitive actions: a fresh single-use reauth token in x-reauth-token. */
export async function requireReauth(req: Request, _res: Response, next: NextFunction): Promise<void> {
    try {
        const agent = agentOf(req);
        const ok = await consumeReauth(req.header('x-reauth-token') || undefined, agent.id, agent.sid);
        if (!ok) throw new AppError(401, 'Confirmez votre identité avec votre code d’authentification.', 'REAUTH_REQUIRED');
        next();
    } catch (err) {
        next(err);
    }
}
