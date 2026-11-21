import { Types } from 'mongoose';
import { Agent } from '../database/models/agent.model';
import { AgentSession } from '../database/models/agent-session.model';
import { isRole, permissionsFor, ROLE_LABELS, SUPER_MANAGER_MAX } from '../config/permissions';
import { getSupportMember } from './clients/user.client';
import { badRequest, conflict, notFound } from '../utils/errors';
import { issueActivation } from './auth/agent-auth.service';
import { revokeAllSessions } from './auth/session.service';
import { sendEmail } from './clients/notification.client';

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,}$/i;

const parseRoles = (v: unknown): string[] => {
    if (!Array.isArray(v) || v.length === 0) throw badRequest('Choisissez au moins un rôle.', 'BAD_ROLES');
    const roles = [...new Set(v)];
    if (!roles.every(isRole)) throw badRequest('Rôle inconnu.', 'BAD_ROLES');
    return roles as string[];
};

export const agentView = (a: any) => ({
    id: String(a._id), email: a.email, name: a.name, roles: a.roles, permissions: permissionsFor(a.roles),
    status: a.status === 'pending' ? 'pending_activation' : a.status,
    totpEnrolled: Boolean(a.totp?.enrolled), backupCodesLeft: (a.backupCodes ?? []).filter((b: any) => !b.usedAt).length,
    lastLoginAt: a.lastLoginAt ?? null, createdAt: a.createdAt, activeSessions: a.activeSessions ?? 0, activationPending: Boolean(a.activation?.tokenHash && !a.activation?.usedAt),
    activationExpiresAt: a.activation?.expiresAt ?? null, viewsAvailable: Boolean(a.views?.available),
    countries: a.countries ?? [], memberUserId: a.memberUserId ?? null,
});

async function sessionCounts(ids: string[]): Promise<Record<string, number>> {
    const rows = await AgentSession.aggregate([
        { $match: { agentId: { $in: ids.map((i) => new Types.ObjectId(i)) }, revokedAt: null, absoluteExpiresAt: { $gt: new Date() } } },
        { $group: { _id: '$agentId', n: { $sum: 1 } } },
    ]);
    return Object.fromEntries(rows.map((r: any) => [String(r._id), r.n]));
}

export async function listAgents() {
    const docs = await Agent.find({}).sort({ createdAt: 1 }).lean();
    const counts = await sessionCounts(docs.map((d) => String(d._id)));
    return docs.map((d) => agentView({ ...d, activeSessions: counts[String(d._id)] ?? 0 }));
}

export async function getAgentView(id: string) {
    const d = await Agent.findById(id).lean();
    if (!d) throw notFound('Agent introuvable.');
    const counts = await sessionCounts([id]);
    return agentView({ ...d, activeSessions: counts[id] ?? 0 });
}

async function deliverActivation(agent: { email: string; name: string }, url: string, expiresAt: Date) {
    return sendEmail({
        recipient: agent.email,
        subject: 'SBC Support : activez votre compte',
        body: `Bonjour ${agent.name},\n\nUn compte SBC Support a été créé pour vous. Ouvrez ce lien pour choisir votre mot de passe (valable jusqu’au ${expiresAt.toISOString().slice(0, 16).replace('T', ' ')} UTC, une seule fois) :\n\n${url}\n\nVous configurerez ensuite votre application d’authentification. Personne chez SBC ne vous demandera jamais ce lien, votre mot de passe ou vos codes.`,
        tag: `agent-activation-${Date.now()}`,
    });
}

/**
 * Creates an agent with a one-time activation link (48 h). The link is
 * returned once to the admin, who hands it over (the desk shows it once and
 * never stores it); with delivery 'email' it is emailed to the agent instead.
 * It is never logged and only its hash is stored.
 */
/** Security plan Phase 5: super_manager is for 1–2 named accounts only. */
async function assertSuperManagerRoom(roles: string[], exceptId?: string) {
    if (!roles.includes('super_manager')) return;
    const others = await Agent.countDocuments({ roles: 'super_manager', status: { $ne: 'disabled' }, ...(exceptId ? { _id: { $ne: exceptId } } : {}) });
    if (others >= SUPER_MANAGER_MAX) throw conflict(`Il y a déjà ${SUPER_MANAGER_MAX} super responsables : retirez le rôle à l’un d’eux d’abord.`, 'SUPER_MANAGER_LIMIT');
}

export async function createAgent(body: Record<string, unknown>, by: string) {
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 120) : '';
    if (!EMAIL_RE.test(email)) throw badRequest('Email invalide.', 'BAD_EMAIL');
    if (name.length < 2) throw badRequest('Nom obligatoire.', 'BAD_NAME');
    const roles = parseRoles(body.roles);
    await assertSuperManagerRoom(roles);
    let agent;
    try {
        agent = await Agent.create({ email, name, roles, status: 'pending', createdBy: Types.ObjectId.isValid(by) ? by : null });
    } catch (err: any) {
        if (err?.code === 11000) throw conflict('Un agent utilise déjà cet email.', 'EMAIL_TAKEN');
        throw err;
    }
    const link = await issueActivation(String(agent._id), by);
    const byEmail = body.delivery === 'email';
    const emailed = byEmail ? await deliverActivation(agent, link.url, link.expiresAt) : false;
    return { agent: agentView(agent.toObject()), emailed, ...(byEmail ? {} : { activationUrl: link.url }), activationExpiresAt: link.expiresAt };
}

export async function updateRoles(id: string, rolesIn: unknown, actorId: string) {
    if (!Types.ObjectId.isValid(id)) throw notFound();
    const roles = parseRoles(rolesIn);
    if (id === actorId && !roles.includes('support_admin')) throw badRequest('Vous ne pouvez pas retirer votre propre rôle d’administrateur.', 'SELF_DEMOTE');
    await assertSuperManagerRoom(roles, id);
    const before = await Agent.findByIdAndUpdate(id, { $set: { roles } }).lean();
    if (!before) throw notFound('Agent introuvable.');
    return { before: before.roles, after: roles };
}

/** Country team (Phase 11 activity panel; Phase 5 will filter tickets and cases too). Empty = every country. */
export async function setCountries(id: string, input: unknown) {
    if (!Types.ObjectId.isValid(id)) throw notFound();
    if (!Array.isArray(input)) throw badRequest('Liste de pays attendue.', 'BAD_COUNTRIES');
    const countries = [...new Set(input.map((c) => String(c).trim().toUpperCase()))];
    if (countries.length > 40 || !countries.every((c) => /^[A-Z]{2}$/.test(c))) throw badRequest('Codes pays à deux lettres (CM, BJ…).', 'BAD_COUNTRIES');
    const before = await Agent.findByIdAndUpdate(id, { $set: { countries } }).lean();
    if (!before) throw notFound('Agent introuvable.');
    return { before: before.countries ?? [], after: countries };
}

/**
 * The agent's own SBC member account (Phase 5 conflict rule): they will never be
 * able to request, approve or work on anything about it or its referral tree.
 * null = no member account.
 */
export async function setMemberAccount(id: string, userId: unknown) {
    if (!Types.ObjectId.isValid(id)) throw notFound();
    let value: string | null = null;
    if (userId !== null && userId !== '') {
        if (typeof userId !== 'string' || !/^[a-f0-9]{24}$/i.test(userId)) throw badRequest('Identifiant de membre invalide.', 'BAD_MEMBER');
        if (!(await getSupportMember(userId))) throw badRequest('Membre introuvable.', 'BAD_MEMBER');
        value = userId;
    }
    const before = await Agent.findByIdAndUpdate(id, { $set: { memberUserId: value } }).lean();
    if (!before) throw notFound('Agent introuvable.');
    return { before: before.memberUserId ?? null, after: value };
}

export async function setStatus(id: string, status: unknown, actorId: string) {
    if (!Types.ObjectId.isValid(id)) throw notFound();
    if (status !== 'active' && status !== 'disabled') throw badRequest('Statut inconnu.', 'BAD_STATUS');
    if (id === actorId) throw badRequest('Vous ne pouvez pas désactiver votre propre compte.', 'SELF_DISABLE');
    const filter = status === 'active' ? { _id: id, status: 'disabled', passwordHash: { $ne: null } } : { _id: id, status: { $ne: 'disabled' } };
    const before = await Agent.findOneAndUpdate(filter, { $set: { status, disabledAt: status === 'disabled' ? new Date() : null, ...(status === 'disabled' ? { 'views.available': false } : {}) } }).lean();
    if (!before) throw conflict('Changement impossible (déjà dans cet état, ou compte jamais activé).', 'NO_CHANGE');
    if (status === 'disabled') await revokeAllSessions(id, 'disabled');
    return { before: before.status, after: status };
}

/** Lost phone / compromised account: password, TOTP and backup codes are wiped, a new link is sent. */
export async function resetAgent(id: string, by: string, delivery: unknown) {
    if (!Types.ObjectId.isValid(id)) throw notFound();
    if (id === by) throw badRequest('Demandez à un autre administrateur de réinitialiser votre compte.', 'SELF_RESET');
    const agent = await Agent.findOneAndUpdate({ _id: id, status: { $ne: 'disabled' } }, {
        $set: { status: 'pending', passwordHash: null, 'totp.enrolled': false, 'totp.secretEnc': null, 'totp.lastUsedStep': null, backupCodes: [], knownDevices: [] },
    }, { new: true }).lean();
    if (!agent) throw notFound('Agent introuvable ou désactivé (réactivez-le d’abord).');
    await revokeAllSessions(id, 'reset');
    const link = await issueActivation(id, by);
    const byEmail = delivery === 'email';
    const emailed = byEmail ? await deliverActivation(agent, link.url, link.expiresAt) : false;
    return { emailed, ...(byEmail ? {} : { activationUrl: link.url }), activationExpiresAt: link.expiresAt };
}

export async function listSessions(id: string) {
    if (!Types.ObjectId.isValid(id)) throw notFound();
    const s = await AgentSession.find({ agentId: id }, { refreshHash: 0, usedRefreshHashes: 0 }).sort({ createdAt: -1 }).limit(50).lean();
    return s.map((x) => ({ id: String(x._id), createdAt: x.createdAt, lastActivityAt: x.lastActivityAt, revokedAt: x.revokedAt, revokeReason: x.revokeReason, ip: x.ip, userAgent: x.userAgent }));
}

export const roleList = () => Object.entries(ROLE_LABELS).map(([key, label]) => ({ key, label, permissions: permissionsFor([key]) }));
