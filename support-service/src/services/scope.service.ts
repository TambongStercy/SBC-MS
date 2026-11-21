import { Agent } from '../database/models/agent.model';
import { forbidden, notFound } from '../utils/errors';
import { getSupportMember, areRelated } from './clients/user.client';
import { audit } from './audit.service';

/**
 * Security plan Phase 5: who may see and act on what.
 *   - Country teams: an agent with `countries` sees only the tickets and cases of
 *     those countries (empty = every country). Items with no known country are
 *     for agents without a team.
 *   - Conflict of interest: an agent may never act on a request or case about
 *     their own member account or an account in its referral tree (3 levels up
 *     or down). Checked against user-service; fails closed when it is down.
 */

export const teamFilter = (team: string[] | undefined | null): Record<string, unknown> =>
    team && team.length ? { country: { $in: team } } : {};

/** 404, not 403: an agent outside the team must not learn that the item exists. */
export function assertInTeam(country: string | null | undefined, team: string[] | undefined | null, what = 'Élément'): void {
    if (!team || !team.length) return;
    if (!country || !team.includes(country)) throw notFound(`${what} introuvable.`);
}

const COUNTRY = /^[A-Z]{2}$/;
const countryCache = new Map<string, { at: number; country: string | null }>();
const COUNTRY_TTL_MS = 10 * 60 * 1000;

/** The member's declared country (ISO), best effort: null when unknown or user-service is down. */
export async function memberCountry(userId: string | null | undefined): Promise<string | null> {
    if (!userId || !/^[a-f0-9]{24}$/i.test(userId)) return null;
    const hit = countryCache.get(userId);
    if (hit && Date.now() - hit.at < COUNTRY_TTL_MS) return hit.country;
    try {
        const m = await getSupportMember(userId);
        const c = String(m?.country ?? '').trim().toUpperCase();
        const country = COUNTRY.test(c) ? c : null;
        countryCache.set(userId, { at: Date.now(), country });
        if (countryCache.size > 5000) countryCache.clear();
        return country;
    } catch {
        return null;
    }
}

/**
 * Refuses (403 CONFLICT_OF_INTEREST, audited) when the agent's own member
 * account is the subject or in its referral tree. No member account linked to
 * the agent: nothing to check.
 */
export async function assertNoConflict(
    agent: { id: string; name: string; roles: string[] }, subjectUserId: string | null | undefined,
    ctx: { ip?: string; userAgent?: string; action?: string } = {},
): Promise<void> {
    if (!subjectUserId) return;
    const a = await Agent.findById(agent.id, { memberUserId: 1 }).lean();
    const own = a?.memberUserId;
    if (!own) return;
    const conflict = own === subjectUserId || await areRelated(own, subjectUserId);
    if (!conflict) return;
    await audit({
        actor: { type: 'agent', ...agent }, action: 'conflict_of_interest.refused', result: 'denied',
        target: { type: 'member', id: subjectUserId }, meta: { attempted: ctx.action ?? null, own: own === subjectUserId ? 'self' : 'referral_tree' },
        ip: ctx.ip, userAgent: ctx.userAgent,
    });
    throw forbidden('Ce membre est votre propre compte ou fait partie de votre parrainage : un autre agent doit s’en occuper.', 'CONFLICT_OF_INTEREST');
}
