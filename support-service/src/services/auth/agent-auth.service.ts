import config from '../../config';
import { Agent, AgentDoc, IAgent } from '../../database/models/agent.model';
import { redis, k } from '../../lib/redis';
import { hit, reset } from '../../lib/rate-limit';
import { AppError, badRequest, tooMany } from '../../utils/errors';
import { hmacHex, randomToken, sha256Hex } from '../../utils/crypto';
import { permissionsFor } from '../../config/permissions';
import { audit, auditSafe } from '../audit.service';
import { notifyAgents } from '../notifier.service';
import { sendEmail } from '../clients/notification.client';
import { hashPassword, passwordProblem, verifyPassword } from './password.service';
import {
    decryptSecret, encryptSecret, enrollmentPayload, generateBackupCodes, generateSecret, hashBackupCode, verifyTotp,
} from './totp.service';
import { createSession, IssuedSession, revokeAllSessions } from './session.service';

/** The one answer to every failed sign-in, whatever the reason (no enumeration). */
export const INVALID_CREDENTIALS = () => new AppError(401, 'Identifiants ou code invalides.', 'INVALID_CREDENTIALS');

export interface ReqCtx { ip: string; userAgent: string }

interface Challenge { agentId: string; stage: 'totp' | 'enroll'; attempts: number; secretEnc?: string; ip: string }

const accountKey = (email: string) => hmacHex(config.secrets.service, `acct:${String(email || '').trim().toLowerCase()}`).slice(0, 32);
const deviceHash = (agentId: string, ctx: ReqCtx) => sha256Hex(`${agentId}|${ctx.ip}|${ctx.userAgent}`);

// Progressive lockout: every 5 failures in 24 h locks the account longer.
const LOCK_STEPS_SEC = [15 * 60, 60 * 60, 24 * 60 * 60];

export function publicAgent(a: Pick<IAgent, 'email' | 'name' | 'roles'> & { _id: unknown }) {
    return { id: String(a._id), name: a.name, email: a.email, roles: a.roles, permissions: permissionsFor(a.roles) };
}

async function isLocked(acct: string): Promise<boolean> {
    return (await redis().exists(k(`loginlock:${acct}`))) === 1;
}

async function recordFailure(acct: string, agent: AgentDoc | null, ctx: ReqCtx, what: string): Promise<void> {
    const r = await hit(`loginfail:${acct}`, Number.MAX_SAFE_INTEGER, 24 * 3600);
    auditSafe({
        actor: { type: 'anonymous' }, action: 'auth.login.failed', result: 'denied',
        target: agent ? { type: 'agent', id: String(agent._id) } : { type: 'account', id: acct },
        meta: { step: what, failures: r.count }, ip: ctx.ip, userAgent: ctx.userAgent,
    });
    if (r.count % 5 !== 0) return;
    const level = Math.min(r.count / 5, LOCK_STEPS_SEC.length) - 1;
    const seconds = LOCK_STEPS_SEC[level];
    await redis().set(k(`loginlock:${acct}`), '1', 'EX', seconds);
    auditSafe({
        actor: { type: 'system' }, action: 'auth.lockout', result: 'ok',
        target: agent ? { type: 'agent', id: String(agent._id) } : { type: 'account', id: acct },
        meta: { failures: r.count, lockSeconds: seconds }, ip: ctx.ip, userAgent: ctx.userAgent,
    });
    if (agent) {
        const minutes = Math.round(seconds / 60);
        await sendEmail({
            recipient: agent.email,
            subject: 'SBC Support : connexion bloquée sur votre compte',
            body: `Après plusieurs tentatives de connexion échouées, votre compte SBC Support est bloqué pendant ${minutes} minutes. Si ce n’était pas vous, prévenez immédiatement l’administrateur du support.`,
            tag: `lockout-${agent._id}-${r.count}`,
        });
        await notifyAgents({
            role: 'support_admin', kind: 'auth.lockout', title: 'Compte agent bloqué',
            body: `Le compte de ${agent.name} est bloqué après ${r.count} échecs de connexion.`,
            link: '/admin/agents', dedupKey: `lockout:${agent._id}:${new Date().toISOString().slice(0, 13)}:${r.count}`,
        });
    }
}

async function saveChallenge(id: string, c: Challenge): Promise<void> {
    await redis().set(k(`chal:${id}`), JSON.stringify(c), 'EX', config.auth.challengeTtlSec);
}

async function loadChallenge(id: unknown): Promise<Challenge | null> {
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{20,80}$/.test(id)) return null;
    const raw = await redis().get(k(`chal:${id}`));
    return raw ? (JSON.parse(raw) as Challenge) : null;
}

/**
 * Step 1: email + password. Same error and timing for every refusal. The anti-robot check
 * (ALTCHA) is done by the gateway before this (ROBOT_CHECK, action `desk_login`).
 */
export async function login(input: { email?: unknown; password?: unknown }, ctx: ReqCtx): Promise<{ step: 'totp' | 'enroll'; challengeId: string }> {
    const ipHit = await hit(`login-ip:${ctx.ip}`, 30, 15 * 60);
    if (!ipHit.allowed) throw tooMany('Trop de tentatives depuis cette adresse. Réessayez plus tard.', ipHit.retryAfterSec);

    const email = typeof input.email === 'string' ? input.email.trim().toLowerCase().slice(0, 200) : '';
    const password = typeof input.password === 'string' ? input.password.slice(0, 200) : '';
    const acct = accountKey(email);
    const agent = email ? await Agent.findOne({ email }) : null;
    const locked = await isLocked(acct);
    const passwordOk = await verifyPassword(agent?.passwordHash, password);

    if (!agent || !passwordOk || locked || agent.status !== 'active') {
        if (!locked) await recordFailure(acct, agent, ctx, 'password');
        else auditSafe({ actor: { type: 'anonymous' }, action: 'auth.login.locked', result: 'denied', target: agent ? { type: 'agent', id: String(agent._id) } : null, ip: ctx.ip, userAgent: ctx.userAgent });
        throw INVALID_CREDENTIALS();
    }

    const challengeId = randomToken(24);
    const stage = agent.totp?.enrolled && agent.totp.secretEnc ? 'totp' : 'enroll';
    await saveChallenge(challengeId, { agentId: String(agent._id), stage, attempts: 0, ip: ctx.ip });
    return { step: stage, challengeId };
}

async function failChallenge(id: string, c: Challenge, agent: AgentDoc | null, ctx: ReqCtx): Promise<never> {
    c.attempts += 1;
    if (c.attempts >= 5) await redis().del(k(`chal:${id}`));
    else await saveChallenge(id, c);
    if (agent) await recordFailure(accountKey(agent.email), agent, ctx, 'totp');
    throw INVALID_CREDENTIALS();
}

async function finishLogin(agent: AgentDoc, ctx: ReqCtx, method: string): Promise<IssuedSession> {
    const agentId = String(agent._id);
    const dh = deviceHash(agentId, ctx);
    const known = agent.knownDevices.some((d) => d.hash === dh);
    const isFirst = agent.knownDevices.length === 0;
    const now = new Date();
    const devices = known
        ? agent.knownDevices.map((d) => (d.hash === dh ? { ...d, lastSeenAt: now } : d))
        : [...agent.knownDevices, { hash: dh, firstSeenAt: now, lastSeenAt: now }].slice(-20);
    await Agent.updateOne({ _id: agent._id }, { $set: { knownDevices: devices, lastLoginAt: now, lastLoginIp: ctx.ip } });
    await reset(`loginfail:${accountKey(agent.email)}`);
    const session = await createSession(agentId, agent.roles, { ip: ctx.ip, userAgent: ctx.userAgent, deviceHash: dh });
    await audit({
        actor: { type: 'agent', id: agentId, name: agent.name, roles: agent.roles }, action: 'auth.login',
        target: { type: 'session', id: session.sessionId }, meta: { method, newDevice: !known }, ip: ctx.ip, userAgent: ctx.userAgent,
    });
    if (!known && !isFirst) {
        await sendEmail({
            recipient: agent.email,
            subject: 'SBC Support : nouvelle connexion à votre compte',
            body: `Une connexion à votre compte SBC Support vient d’avoir lieu depuis un appareil ou une adresse inconnus (adresse IP ${ctx.ip}, ${now.toISOString()}). Si ce n’était pas vous, prévenez immédiatement l’administrateur du support.`,
            tag: `newdevice-${agentId}-${dh.slice(0, 12)}`,
        });
    }
    return session;
}

/** Step 2: TOTP code or a backup code (single use). */
export async function completeTotp(input: { challengeId?: unknown; code?: unknown; backupCode?: unknown }, ctx: ReqCtx) {
    const ipHit = await hit(`totp-ip:${ctx.ip}`, 30, 15 * 60);
    if (!ipHit.allowed) throw tooMany(undefined, ipHit.retryAfterSec);
    const id = input.challengeId as string;
    const c = await loadChallenge(id);
    if (!c || c.stage !== 'totp') throw INVALID_CREDENTIALS();
    const agent = await Agent.findById(c.agentId);
    if (!agent || agent.status !== 'active' || !agent.totp?.secretEnc || (await isLocked(accountKey(agent.email)))) {
        await redis().del(k(`chal:${id}`));
        throw INVALID_CREDENTIALS();
    }

    let method = 'totp';
    if (typeof input.backupCode === 'string' && input.backupCode.trim()) {
        const h = hashBackupCode(input.backupCode);
        const r = await Agent.updateOne(
            { _id: agent._id, backupCodes: { $elemMatch: { hash: h, usedAt: null } } },
            { $set: { 'backupCodes.$.usedAt': new Date() } },
        );
        if (r.modifiedCount !== 1) return failChallenge(id, c, agent, ctx);
        method = 'backup_code';
    } else {
        const step = verifyTotp(decryptSecret(agent.totp.secretEnc), String(input.code ?? ''));
        if (step === null) return failChallenge(id, c, agent, ctx);
        // Refuse a code whose step was already used (replay), atomically.
        const r = await Agent.updateOne(
            { _id: agent._id, $or: [{ 'totp.lastUsedStep': null }, { 'totp.lastUsedStep': { $lt: step } }] },
            { $set: { 'totp.lastUsedStep': step } },
        );
        if (r.modifiedCount !== 1) return failChallenge(id, c, agent, ctx);
    }
    // The challenge is single use.
    if ((await redis().del(k(`chal:${id}`))) !== 1) throw INVALID_CREDENTIALS();
    const session = await finishLogin(agent, ctx, method);
    const remaining = agent.backupCodes.filter((b) => !b.usedAt).length - (method === 'backup_code' ? 1 : 0);
    return { agent: publicAgent(agent), session, backupCodesRemaining: remaining };
}

/** First sign-in: generate a secret, kept in the challenge until confirmed. */
export async function enrollStart(input: { challengeId?: unknown }) {
    const id = input.challengeId as string;
    const c = await loadChallenge(id);
    if (!c || c.stage !== 'enroll') throw INVALID_CREDENTIALS();
    const agent = await Agent.findById(c.agentId);
    if (!agent || agent.status !== 'active') throw INVALID_CREDENTIALS();
    // One secret per challenge, whoever asks first: a double click, a page reload or
    // React's double effect in development sends two starts at once, and two
    // different secrets would leave the screen showing one key while the server
    // checks codes against the other (every code refused).
    const slot = k(`chalsecret:${id}`);
    await redis().set(slot, encryptSecret(generateSecret()), 'EX', config.auth.challengeTtlSec, 'NX');
    const secretEnc = await redis().get(slot);
    if (!secretEnc) throw INVALID_CREDENTIALS();
    c.secretEnc = secretEnc;
    await saveChallenge(id, c);
    return enrollmentPayload(decryptSecret(secretEnc), agent.email);
}

export async function enrollConfirm(input: { challengeId?: unknown; code?: unknown }, ctx: ReqCtx) {
    const id = input.challengeId as string;
    const c = await loadChallenge(id);
    if (!c || c.stage !== 'enroll' || !c.secretEnc) throw INVALID_CREDENTIALS();
    const agent = await Agent.findById(c.agentId);
    if (!agent || agent.status !== 'active') throw INVALID_CREDENTIALS();
    const step = verifyTotp(decryptSecret(c.secretEnc), String(input.code ?? ''));
    if (step === null) return failChallenge(id, c, agent, ctx);
    const { codes, hashes } = generateBackupCodes(10);
    const r = await Agent.updateOne(
        { _id: agent._id, 'totp.enrolled': { $ne: true } },
        {
            $set: {
                'totp.secretEnc': c.secretEnc, 'totp.enrolled': true, 'totp.enrolledAt': new Date(), 'totp.lastUsedStep': step,
                backupCodes: hashes.map((hash) => ({ hash, usedAt: null })),
            },
        },
    );
    if ((await redis().del(k(`chal:${id}`))) !== 1 || r.modifiedCount !== 1) throw INVALID_CREDENTIALS();
    await audit({ actor: { type: 'agent', id: String(agent._id), name: agent.name, roles: agent.roles }, action: 'auth.totp.enrolled', target: { type: 'agent', id: String(agent._id) }, ip: ctx.ip, userAgent: ctx.userAgent });
    const fresh = (await Agent.findById(agent._id))!;
    const session = await finishLogin(fresh, ctx, 'totp_enroll');
    return { agent: publicAgent(fresh), session, backupCodes: codes };
}

/** One-time activation link: sets the password; TOTP enrolment follows at first sign-in. */
export async function activate(input: { token?: unknown; password?: unknown }, ctx: ReqCtx) {
    const ipHit = await hit(`activate-ip:${ctx.ip}`, 20, 15 * 60);
    if (!ipHit.allowed) throw tooMany(undefined, ipHit.retryAfterSec);
    const token = typeof input.token === 'string' ? input.token : '';
    const password = typeof input.password === 'string' ? input.password : '';
    const invalid = () => new AppError(400, 'Ce lien d’activation est invalide ou expiré. Demandez-en un nouveau à l’administrateur.', 'ACTIVATION_INVALID');
    if (!/^[A-Za-z0-9_-]{30,100}$/.test(token)) throw invalid();
    const tokenHash = sha256Hex(token);
    const agent = await Agent.findOne({ 'activation.tokenHash': tokenHash, 'activation.usedAt': null, 'activation.expiresAt': { $gt: new Date() } });
    if (!agent || agent.status === 'disabled') throw invalid();
    const problem = passwordProblem(password, { email: agent.email, name: agent.name });
    if (problem) throw badRequest(problem, 'WEAK_PASSWORD');
    const passwordHash = await hashPassword(password);
    const r = await Agent.updateOne(
        { _id: agent._id, 'activation.tokenHash': tokenHash, 'activation.usedAt': null },
        {
            $set: {
                passwordHash, passwordChangedAt: new Date(), status: 'active', 'activation.usedAt': new Date(), 'activation.tokenHash': null,
                'totp.enrolled': false, 'totp.secretEnc': null, 'totp.lastUsedStep': null, backupCodes: [],
            },
        },
    );
    if (r.modifiedCount !== 1) throw invalid();
    await revokeAllSessions(String(agent._id), 'activation');
    await audit({ actor: { type: 'agent', id: String(agent._id), name: agent.name, roles: agent.roles }, action: 'auth.activated', target: { type: 'agent', id: String(agent._id) }, ip: ctx.ip, userAgent: ctx.userAgent });
    return { ok: true };
}

/** Issues a single-use activation token (48 h). Only the hash is stored. */
export async function issueActivation(agentId: string, createdBy: string | null): Promise<{ token: string; url: string; expiresAt: Date }> {
    const token = randomToken(32);
    const expiresAt = new Date(Date.now() + config.auth.activationTtlMs);
    await Agent.updateOne({ _id: agentId }, {
        $set: { activation: { tokenHash: sha256Hex(token), expiresAt, usedAt: null, createdBy } },
    });
    return { token, url: `${config.publicUrl}/activate#${token}`, expiresAt };
}

/** Re-authentication before a sensitive action: TOTP code → 5-minute single-use token. */
export async function reauth(agentId: string, sid: string, code: unknown, ctx: ReqCtx): Promise<string> {
    const lim = await hit(`reauth:${agentId}`, 10, 15 * 60);
    if (!lim.allowed) throw tooMany(undefined, lim.retryAfterSec);
    const agent = await Agent.findById(agentId);
    if (!agent?.totp?.secretEnc) throw INVALID_CREDENTIALS();
    const step = verifyTotp(decryptSecret(agent.totp.secretEnc), String(code ?? ''));
    let ok = false;
    if (step !== null) {
        const r = await Agent.updateOne(
            { _id: agent._id, $or: [{ 'totp.lastUsedStep': null }, { 'totp.lastUsedStep': { $lt: step } }] },
            { $set: { 'totp.lastUsedStep': step } },
        );
        ok = r.modifiedCount === 1;
    }
    if (!ok) {
        auditSafe({ actor: { type: 'agent', id: agentId, name: agent.name, roles: agent.roles }, action: 'auth.reauth.failed', result: 'denied', ip: ctx.ip, userAgent: ctx.userAgent });
        throw INVALID_CREDENTIALS();
    }
    const token = randomToken(32);
    await redis().set(k(`reauth:${sha256Hex(token)}`), JSON.stringify({ agentId, sid }), 'EX', config.auth.reauthTtlSec);
    auditSafe({ actor: { type: 'agent', id: agentId, name: agent.name, roles: agent.roles }, action: 'auth.reauth', ip: ctx.ip, userAgent: ctx.userAgent });
    return token;
}

/** Consumes a reauth token (GETDEL: single use). */
export async function consumeReauth(token: string | undefined, agentId: string, sid: string): Promise<boolean> {
    if (!token || !/^[A-Za-z0-9_-]{30,100}$/.test(token)) return false;
    const raw = await redis().getdel(k(`reauth:${sha256Hex(token)}`));
    if (!raw) return false;
    const v = JSON.parse(raw);
    return v.agentId === agentId && v.sid === sid;
}

