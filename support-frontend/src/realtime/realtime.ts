import { useEffect, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api/http';

/**
 * Live ticket updates through LiveKit (support-service realtime.service).
 *
 * The agent app joins the desk room with a listen-only token. Each data message
 * says only which ticket changed (`{ type:'ticket', ticketId, kind }`); the app
 * then reloads that ticket and the lists through the normal API. While the
 * connection is up, pages poll slowly (a safety net); when it is down or
 * LiveKit is not configured, they keep polling every few seconds.
 */

type TokenAnswer = { enabled: false } | { enabled: true; url: string; room: string; token: string };
export type TicketSignal = { type: 'ticket'; ticketId: string; kind: string };

let connected = false;
const listeners = new Set<() => void>();
const setConnected = (v: boolean) => { if (v !== connected) { connected = v; listeners.forEach(l => l()); } };

/** True while the live connection is up: pages then poll only as a safety net. */
export function useRealtimeConnected(): boolean {
  return useSyncExternalStore(cb => { listeners.add(cb); return () => listeners.delete(cb); }, () => connected, () => false);
}

/** Polling interval for a live page: fast without the connection, a safety net with it. */
export const livePoll = (isConnected: boolean, fastMs: number) => (isConnected ? 60_000 : fastMs);

export function parseSignal(bytes: Uint8Array, topic?: string): TicketSignal | null {
  if (topic && topic !== 'support') return null;
  try {
    const v = JSON.parse(new TextDecoder().decode(bytes));
    return v && v.type === 'ticket' && typeof v.ticketId === 'string' ? v : null;
  } catch {
    return null;
  }
}

/** Mount once, for an agent who can read tickets. Reconnects with a fresh token after a drop. */
export function useDeskRealtime(enabled: boolean) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let room: { disconnect: () => Promise<void> } | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;

    const onSignal = (s: TicketSignal) => {
      void qc.invalidateQueries({ queryKey: ['tickets', 'detail', s.ticketId] });
      void qc.invalidateQueries({ queryKey: ['tickets', 'list'] });
      void qc.invalidateQueries({ queryKey: ['tickets', 'queues'] });
      void qc.invalidateQueries({ queryKey: ['home', 'tickets'] });
    };

    const connect = async () => {
      try {
        const t = await api.get<TokenAnswer>('/realtime/token');
        if (stopped || !t.enabled) return;
        const { Room, RoomEvent } = await import('livekit-client');
        const r = new Room({ adaptiveStream: false, dynacast: false });
        r.on(RoomEvent.DataReceived, (payload: Uint8Array, _p: unknown, _k: unknown, topic?: string) => {
          const s = parseSignal(payload, topic);
          if (s) onSignal(s);
        });
        r.on(RoomEvent.Disconnected, () => { setConnected(false); if (!stopped) schedule(); });
        r.on(RoomEvent.Reconnecting, () => setConnected(false));
        r.on(RoomEvent.Reconnected, () => setConnected(true));
        await r.connect(t.url, t.token, { autoSubscribe: false });
        if (stopped) { await r.disconnect(); return; }
        room = r;
        attempt = 0;
        setConnected(true);
        // Catch up on anything that happened while not connected.
        void qc.invalidateQueries({ queryKey: ['tickets'] });
      } catch {
        setConnected(false);
        if (!stopped) schedule();
      }
    };
    const schedule = () => {
      clearTimeout(retry);
      retry = setTimeout(connect, Math.min(60_000, 5_000 * 2 ** attempt++));
    };

    void connect();
    return () => {
      stopped = true;
      clearTimeout(retry);
      setConnected(false);
      void room?.disconnect();
    };
  }, [enabled, qc]);
}
