import { Types } from 'mongoose';
import config from '../config';
import { AssistGrant } from '../database/models/assist-grant.model';
import { Ticket } from '../database/models/ticket.model';
import { badRequest, notFound, serviceUnavailable } from '../utils/errors';
import { audit } from './audit.service';
import { assertInTeam, assertNoConflict, memberCountry } from './scope.service';
import { addSystemNote } from './ticket.service';
import {
    liveSessions, liveUrl, openReplayApiEnabled, recordedSessions, recordingUrl, type ReplaySession,
} from './clients/openreplay.client';
import logger from '../utils/logger';

/**
 * Session replay and live assistance from the desk (2026-11-23).
 *
 * - « Sessions » on the member card (`replay.read`): the member's recordings of the last 30 days
 *   and the sessions open right now, read from OpenReplay with support-service's own account.
 *   Listing and every opening are audited.
 * - « Regarder » on a live session opens a watch-only grant; « Assistance en direct »
 *   (`assist.control`) a grant that may also ask for control, for ASSIST_GRANT_MINUTES. The member
 *   app asks `GET /me/assist/grant?agent=<email>` before it shows the viewing prompt and the
 *   control prompt, so an OpenReplay user acting outside the desk is declined without the member
 *   being asked; the member still has to accept each one, and sensitive screens refuse control
 *   whatever happens.
 */

const log = logger.getLogger('Assist');
type AgentLike = { id: string; name: string; email: string; roles: string[]; countries?: string[] };
type Ctx = { ip?: string; userAgent?: string };

const MEMBER_ID = /^[a-f0-9]{24}$/i;
const SESSION_ID = /^\d{1,30}$/;

function assertMemberId(memberId: string) {
    if (!MEMBER_ID.test(memberId)) throw badRequest('Identifiant de membre invalide.');
}
function assertReady() {
    if (!openReplayApiEnabled()) throw serviceUnavailable('Les enregistrements de session ne sont pas configurés.', 'REPLAY_OFF');
}
async function assertMayAct(agent: AgentLike, memberId: string, ctx: Ctx & { action: string }) {
    assertInTeam(await memberCountry(memberId), agent.countries, 'Membre');
    await assertNoConflict(agent, memberId, ctx);
}

const actor = (a: AgentLike) => ({ type: 'agent' as const, id: a.id, name: a.name, roles: a.roles });

/** The member's live sessions and recordings (no links: each opening goes through `openSession`). */
export async function memberSessions(memberId: string, agent: AgentLike, ctx: Ctx): Promise<{ live: ReplaySession[]; recorded: ReplaySession[] }> {
    assertMemberId(memberId);
    assertReady();
    await assertMayAct(agent, memberId, { ...ctx, action: 'member.sessions.listed' });
    let live: ReplaySession[] = [];
    let recorded: ReplaySession[] = [];
    try {
        [live, recorded] = await Promise.all([liveSessions(memberId), recordedSessions(memberId)]);
    } catch (err) {
        log.warn(`OpenReplay unreachable for member sessions: ${(err as Error).message}`);
        throw serviceUnavailable('Le serveur d’enregistrement ne répond pas. Réessayez dans un instant.', 'REPLAY_UNAVAILABLE');
    }
    const liveIds = new Set(live.map((s) => s.sessionId));
    recorded = recorded.filter((s) => !liveIds.has(s.sessionId));
    await audit({ actor: actor(agent), action: 'member.sessions.listed', target: { type: 'member', id: memberId }, meta: { live: live.length, recorded: recorded.length }, ...ctx });
    return { live, recorded };
}

/** One recording (or the live view, to watch), audited. */
export async function openSession(memberId: string, sessionId: string, live: boolean, agent: AgentLike, ctx: Ctx): Promise<{ url: string }> {
    assertMemberId(memberId);
    if (!SESSION_ID.test(sessionId)) throw badRequest('Session invalide.');
    assertReady();
    await assertMayAct(agent, memberId, { ...ctx, action: 'member.session.opened' });
    // Only a session of THIS member: an agent cannot open someone else's by changing the id.
    const sessions = live ? await liveSessions(memberId) : await recordedSessions(memberId, 30, 50);
    if (!sessions.some((s) => s.sessionId === sessionId)) throw notFound('Session introuvable pour ce membre.');
    if (live) await openGrant(memberId, agent, null, false);
    await audit({ actor: actor(agent), action: live ? 'member.live.watched' : 'member.replay.opened', target: { type: 'member', id: memberId }, after: { sessionId }, ...ctx });
    return { url: live ? liveUrl(sessionId) : recordingUrl(sessionId) };
}

/** One open grant per agent and member: a new one replaces the previous one (and its kind). */
async function openGrant(memberId: string, agent: AgentLike, ticketId: Types.ObjectId | null, control: boolean) {
    const now = new Date();
    await AssistGrant.updateMany({ memberId, agentId: agent.id, endedAt: null, expiresAt: { $gt: now } }, { $set: { endedAt: now, endedBy: 'agent' } });
    return AssistGrant.create({
        memberId, agentId: agent.id, agentName: agent.name, agentEmail: agent.email.toLowerCase(), ticketId, control,
        startedAt: now, expiresAt: new Date(now.getTime() + config.openreplay.assistGrantMinutes * 60_000), endedAt: null, endedBy: null,
    });
}

/** « Assistance en direct »: a grant for this agent and member, and the member's live sessions. */
export async function startAssist(memberId: string, input: { ticketId?: unknown }, agent: AgentLike, ctx: Ctx) {
    assertMemberId(memberId);
    assertReady();
    await assertMayAct(agent, memberId, { ...ctx, action: 'assist.started' });
    let ticketId: Types.ObjectId | null = null;
    if (typeof input.ticketId === 'string' && input.ticketId) {
        if (!Types.ObjectId.isValid(input.ticketId)) throw badRequest('Ticket invalide.');
        const t = await Ticket.findById(input.ticketId, { memberId: 1 }).lean();
        if (!t || String(t.memberId) !== memberId) throw notFound('Ticket introuvable pour ce membre.');
        ticketId = t._id as Types.ObjectId;
    }
    let live: ReplaySession[] = [];
    try { live = await liveSessions(memberId); } catch (err) {
        log.warn(`OpenReplay unreachable for live sessions: ${(err as Error).message}`);
        throw serviceUnavailable('Le serveur d’assistance ne répond pas. Réessayez dans un instant.', 'REPLAY_UNAVAILABLE');
    }
    const grant = await openGrant(memberId, agent, ticketId, true);
    await audit({
        actor: actor(agent), action: 'assist.started', target: { type: 'member', id: memberId },
        after: { grantId: String(grant._id), ticketId: ticketId ? String(ticketId) : null, liveSessions: live.length, expiresAt: grant.expiresAt.toISOString() }, ...ctx,
    });
    if (ticketId) await addSystemNote(ticketId, `${agent.name} a ouvert l’assistance en direct (contrôle à distance seulement si le membre l’accepte).`, true);
    return {
        grantId: String(grant._id),
        expiresAt: grant.expiresAt,
        live: live.map((s) => ({ ...s, url: liveUrl(s.sessionId) })),
    };
}

export async function endAssist(grantId: string, agent: AgentLike, ctx: Ctx) {
    if (!Types.ObjectId.isValid(grantId)) throw badRequest('Assistance invalide.');
    const now = new Date();
    const g = await AssistGrant.findOneAndUpdate({ _id: grantId, agentId: agent.id, endedAt: null }, { $set: { endedAt: now, endedBy: 'agent' } }, { new: true }).lean();
    if (!g) throw notFound('Assistance introuvable ou déjà terminée.');
    await audit({ actor: actor(agent), action: 'assist.ended', target: { type: 'member', id: g.memberId }, after: { grantId, minutes: Math.round((now.getTime() - g.startedAt.getTime()) / 60000) }, ...ctx });
    if (g.ticketId) await addSystemNote(g.ticketId, `${agent.name} a terminé l’assistance en direct.`, true);
    return { ended: true };
}

/**
 * Asked by the member app when an OpenReplay agent requests control: is there an open grant
 * from the desk for this member and this agent's e-mail? Answers only yes/no and a first name.
 */
export async function memberGrant(memberId: string, agentEmail: unknown): Promise<{ allowed: boolean; control: boolean; agentName: string | null }> {
    const email = typeof agentEmail === 'string' ? agentEmail.trim().toLowerCase() : '';
    if (!email || email.length > 200 || !MEMBER_ID.test(memberId)) return { allowed: false, control: false, agentName: null };
    const g = await AssistGrant.findOne({ memberId, agentEmail: email, endedAt: null, expiresAt: { $gt: new Date() } }, { agentName: 1, control: 1 }).sort({ startedAt: -1 }).lean();
    return g ? { allowed: true, control: g.control === true, agentName: g.agentName.split(' ')[0] } : { allowed: false, control: false, agentName: null };
}
