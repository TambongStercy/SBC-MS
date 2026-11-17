import { Router, Request, Response } from 'express';
import config from '../../../config';
import { ah } from '../../middleware/async';
import {
    agentOf, clearSessionCookies, reqCtx, requireAgent, setCsrfCookie, setRefreshCookie, setSessionCookies,
} from '../../middleware/agent-auth';
import {
    activate, completeTotp, enrollConfirm, enrollStart, login, publicAgent, reauth,
} from '../../../services/auth/agent-auth.service';
import { revokeAllSessions, revokeSession, rotateRefresh, signAccess, verifyAccess } from '../../../services/auth/session.service';
import { Agent } from '../../../database/models/agent.model';
import { audit } from '../../../services/audit.service';
import { notifyAgents } from '../../../services/notifier.service';
import { sendEmail } from '../../../services/clients/notification.client';
import { unauthorized } from '../../../utils/errors';

const router = Router();

/** Every sign-in answer takes the same minimum time, success or not. */
async function uniform<T>(fn: () => Promise<T>): Promise<T> {
    const start = Date.now();
    try {
        return await fn();
    } finally {
        const wait = config.auth.loginMinMs - (Date.now() - start);
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    }
}

router.get('/csrf', (req: Request, res: Response) => {
    const existing = req.cookies?.[config.cookies.csrf];
    const token = existing || setCsrfCookie(res);
    res.json({ success: true, data: { csrfToken: token } });
});

router.post('/login', ah(async (req, res) => {
    const data = await uniform(() => login(req.body ?? {}, reqCtx(req)));
    res.json({ success: true, data });
}));

router.post('/totp', ah(async (req, res) => {
    const r = await uniform(() => completeTotp(req.body ?? {}, reqCtx(req)));
    setSessionCookies(res, r.session);
    res.json({ success: true, data: { agent: r.agent, backupCodesRemaining: r.backupCodesRemaining } });
}));

router.post('/enroll/start', ah(async (req, res) => {
    const data = await uniform(() => enrollStart(req.body ?? {}));
    res.json({ success: true, data });
}));

router.post('/enroll/confirm', ah(async (req, res) => {
    const r = await uniform(() => enrollConfirm(req.body ?? {}, reqCtx(req)));
    setSessionCookies(res, r.session);
    res.json({ success: true, data: { agent: r.agent, backupCodes: r.backupCodes } });
}));

router.post('/activate', ah(async (req, res) => {
    await uniform(() => activate(req.body ?? {}, reqCtx(req)));
    res.json({ success: true, message: 'Compte activé. Connectez-vous pour configurer votre application d’authentification.' });
}));

router.post('/refresh', ah(async (req, res) => {
    const r = await rotateRefresh(req.cookies?.[config.cookies.refresh]);
    if (r.kind === 'reuse') {
        // A refresh token that was already used: treat as stolen, end every session.
        const n = await revokeAllSessions(r.agentId, 'refresh_reuse');
        const agent = await Agent.findById(r.agentId, { name: 1, email: 1, roles: 1 }).lean();
        await audit({ actor: { type: 'anonymous' }, action: 'auth.refresh_reuse', result: 'denied', target: { type: 'agent', id: r.agentId }, meta: { sessionId: r.sessionId, revoked: n }, ...reqCtx(req) });
        if (agent) {
            await sendEmail({ recipient: agent.email, subject: 'SBC Support : sessions fermées par sécurité', body: 'Un ancien jeton de session de votre compte SBC Support a été réutilisé. Toutes vos sessions ont été fermées : reconnectez-vous. Si cela se reproduit, prévenez l’administrateur du support.', tag: `reuse-${r.agentId}-${r.sessionId}` });
            await notifyAgents({ role: 'support_admin', kind: 'auth.refresh_reuse', title: 'Réutilisation de session détectée', body: `Toutes les sessions de ${agent.name} ont été fermées.`, link: '/admin/agents', dedupKey: `reuse:${r.sessionId}` });
        }
        clearSessionCookies(res);
        throw unauthorized();
    }
    if (r.kind !== 'ok') {
        clearSessionCookies(res);
        throw unauthorized();
    }
    const agent = await Agent.findById(r.agentId, { roles: 1, status: 1, name: 1, email: 1 }).lean();
    if (!agent || agent.status !== 'active') {
        await revokeSession(r.sessionId, 'agent_inactive');
        clearSessionCookies(res);
        throw unauthorized();
    }
    res.cookie(config.cookies.access, signAccess(r.agentId, r.sessionId, agent.roles), {
        httpOnly: true, secure: config.auth.cookieSecure, sameSite: 'strict', path: config.cookies.accessPath, maxAge: config.auth.accessTtlSec * 1000,
    });
    setRefreshCookie(res, r.refreshToken);
    res.json({ success: true, data: { agent: publicAgent(agent as any) } });
}));

router.post('/logout', ah(async (req, res) => {
    const claims = verifyAccess(req.cookies?.[config.cookies.access]);
    const refreshSid = String(req.cookies?.[config.cookies.refresh] || '').split('.')[0];
    const sid = claims?.sid || refreshSid;
    if (sid) await revokeSession(sid, 'logout');
    if (claims) await audit({ actor: { type: 'agent', id: claims.sub, roles: claims.roles }, action: 'auth.logout', target: { type: 'session', id: sid }, ...reqCtx(req) });
    clearSessionCookies(res);
    res.json({ success: true });
}));

router.get('/me', requireAgent, ah(async (req, res) => {
    const a = agentOf(req);
    res.json({ success: true, data: { agent: { id: a.id, name: a.name, email: a.email, roles: a.roles, permissions: a.permissions } } });
}));

router.post('/reauth', requireAgent, ah(async (req, res) => {
    const a = agentOf(req);
    const reauthToken = await reauth(a.id, a.sid, req.body?.code, reqCtx(req));
    res.json({ success: true, data: { reauthToken, expiresInSeconds: config.auth.reauthTtlSec } });
}));

export default router;
