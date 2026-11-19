import config from '../config';

/**
 * OpenReplay session replay attached to a ticket.
 *
 * The member app records each session (self-hosted OpenReplay, inputs masked)
 * and sends the current session's id and dashboard link when the member opens a
 * ticket. The link is kept only if it points at our own OpenReplay dashboard
 * (OPENREPLAY_DASHBOARD_URL): an agent never gets sent to an address a member
 * typed. Off (nothing stored) while OPENREPLAY_DASHBOARD_URL is unset.
 */

export type TicketReplay = { sessionId: string; url: string; at: Date };

export const replayEnabled = () => Boolean(config.openreplay.dashboardUrl);

export function cleanReplay(input: unknown, now = new Date()): TicketReplay | null {
    const base = config.openreplay.dashboardUrl;
    if (!base || !input || typeof input !== 'object') return null;
    const { sessionId, url } = input as { sessionId?: unknown; url?: unknown };
    if (typeof sessionId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(sessionId)) return null;
    if (typeof url !== 'string' || url.length > 500) return null;
    let u: URL, b: URL;
    try { u = new URL(url); b = new URL(base); } catch { return null; }
    if (u.origin !== b.origin || !(u.pathname + '/').startsWith(b.pathname.replace(/\/?$/, '/')) || !u.pathname.includes(sessionId)) return null;
    return { sessionId, url: u.toString(), at: now };
}
