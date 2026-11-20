import { randomBytes } from 'crypto';
import { AccessToken, DataPacket_Kind, RoomServiceClient } from 'livekit-server-sdk';
import config from '../config';
import logger from '../utils/logger';

const log = logger.getLogger('Realtime');

/**
 * Live delivery of ticket events through LiveKit data messages.
 *
 * Two kinds of rooms: one per member (`support-member-<id>`) and one for the
 * whole desk (`support-desk`). An event carries only `{ ticketId, kind }`: the
 * apps then reload the ticket through the normal authenticated API, so nothing
 * readable ever travels through LiveKit. Tokens only allow subscribing: no one
 * can publish into a room except this service. Without LIVEKIT_* the feature is
 * off and both apps keep polling.
 */

export const DESK_ROOM = 'support-desk';
export const memberRoom = (memberId: string) => `support-member-${memberId}`;
/** A request sent without an account: its holder listens to that request only. */
export const guestRoom = (ticketId: string) => `support-guest-${ticketId}`;
export const REALTIME_TOPIC = 'support';

export type TicketEventKind = 'created' | 'message' | 'status' | 'assigned' | 'priority' | 'read';

export function realtimeEnabled(): boolean {
    const l = config.livekit;
    return Boolean(l.url && l.httpUrl && l.apiKey && l.apiSecret);
}

let client: RoomServiceClient | null = null;
const rooms = () => (client ??= new RoomServiceClient(config.livekit.httpUrl, config.livekit.apiKey, config.livekit.apiSecret));

/** For tests. */
export function setRoomClientForTests(c: Pick<RoomServiceClient, 'sendData'> | null) { client = c as RoomServiceClient | null; }

async function send(room: string, payload: Uint8Array) {
    try {
        await rooms().sendData(room, payload, DataPacket_Kind.RELIABLE, { topic: REALTIME_TOPIC });
    } catch (err) {
        // A room nobody is in does not exist: nothing to deliver, not an error.
        log.debug('LiveKit sendData skipped', { room, message: (err as Error)?.message });
    }
}

/**
 * Tells the desk, and the member when it concerns them (never for an internal
 * note), that a ticket changed. Fire and forget: a LiveKit outage never fails
 * or slows the request that caused it.
 */
export function publishTicketEvent(e: { ticketId: string; memberId?: string | null; kind: TicketEventKind; forMember: boolean }): void {
    if (!realtimeEnabled()) return;
    const payload = new TextEncoder().encode(JSON.stringify({ type: 'ticket', ticketId: String(e.ticketId), kind: e.kind, at: new Date().toISOString() }));
    void send(DESK_ROOM, payload);
    if (e.forMember) void send(e.memberId ? memberRoom(String(e.memberId)) : guestRoom(String(e.ticketId)), payload);
}

async function subscribeToken(who: string, room: string, name?: string) {
    // One identity per connection: LiveKit disconnects the older of two participants with the
    // same identity, so a member (or agent) with two tabs or two devices would kick each other forever.
    const identity = `${who}#${randomBytes(4).toString('hex')}`;
    const at = new AccessToken(config.livekit.apiKey, config.livekit.apiSecret, { identity, name, ttl: '4h' });
    at.addGrant({ room, roomJoin: true, canSubscribe: true, canPublish: false, canPublishData: false, canUpdateOwnMetadata: false });
    return { enabled: true as const, url: config.livekit.url, room, token: await at.toJwt() };
}

const DISABLED = { enabled: false as const };

/** A member listens to their own room only. */
export async function memberRealtimeToken(memberId: string) {
    return realtimeEnabled() ? subscribeToken(`member:${memberId}`, memberRoom(memberId)) : DISABLED;
}

/** Agents listen to the desk room (ticket ids only; the API still checks every read). */
export async function deskRealtimeToken(agent: { id: string; name: string }) {
    return realtimeEnabled() ? subscribeToken(`agent:${agent.id}`, DESK_ROOM, agent.name) : DISABLED;
}

/** The holder of a request sent without an account listens to that request's room only. */
export async function guestRealtimeToken(ticketId: string) {
    return realtimeEnabled() ? subscribeToken(`guest:${ticketId}`, guestRoom(ticketId)) : DISABLED;
}
