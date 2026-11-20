import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import App from '../App';
import { mockApi } from '../test/mockApi';
import { makeAgent, renderWithProviders } from '../test/render';
import { parseSignal } from './realtime';

// A fake LiveKit room: records the data handler so the test can deliver a signal.
const fake = vi.hoisted(() => ({ onData: null as null | ((p: Uint8Array, a?: unknown, b?: unknown, topic?: string) => void), connects: 0 }));
vi.mock('livekit-client', () => {
  class Room {
    on(ev: string, cb: NonNullable<typeof fake.onData>) { if (ev === 'dataReceived') fake.onData = cb; return this; }
    async connect() { fake.connects++; }
    async disconnect() {}
  }
  return { Room, RoomEvent: { DataReceived: 'dataReceived', Disconnected: 'disconnected', Reconnecting: 'reconnecting', Reconnected: 'reconnected' } };
});

const enc = (o: unknown) => new TextEncoder().encode(JSON.stringify(o));

describe('live ticket updates', () => {
  it('reads only well-formed support signals', () => {
    expect(parseSignal(enc({ type: 'ticket', ticketId: 't1', kind: 'message' }), 'support')).toMatchObject({ ticketId: 't1' });
    expect(parseSignal(enc({ type: 'ticket', ticketId: 't1' }), 'other')).toBeNull();
    expect(parseSignal(new TextEncoder().encode('not json'))).toBeNull();
  });

  it('reloads the open ticket as soon as a signal arrives, without waiting for polling', async () => {
    document.cookie = 'sbc_sup_csrf=tok; path=/';
    let version = 1;
    const ticket = (body: string) => ({
      ticket: { id: 't1', number: 'SUP-000001', subject: 'Retrait bloqué', category: 'retrait', queue: 'retrait', priority: 'high', status: 'open', source: 'member', member: { id: 'm1', name: 'Jean' }, assignee: null, slaDueAt: null, createdAt: '2026-11-18T08:00:00Z', updatedAt: '2026-11-18T08:00:00Z' },
      messages: [{ id: `m${version}`, author: { type: 'member', id: 'm1', name: 'Jean' }, body, internal: false, attachments: [], createdAt: '2026-11-18T08:00:00Z' }],
      events: [],
    });
    mockApi({
      'GET /auth/me': { data: { agent: makeAgent(['support_agent']) } },
      'GET /realtime/token': { data: { enabled: true, url: 'wss://live.test', room: 'support-desk', token: 'tok' } },
      'GET /tickets/t1': () => ({ data: version === 1 ? ticket('Premier message') : ticket('Message arrivé en direct') }),
    });
    renderWithProviders(<App />, { path: '/tickets/t1' });
    expect(await screen.findByText('Premier message')).toBeInTheDocument();
    await waitFor(() => expect(fake.onData).not.toBeNull());

    version = 2;
    fake.onData!(enc({ type: 'ticket', ticketId: 't1', kind: 'message' }), undefined, undefined, 'support');
    expect(await screen.findByText('Message arrivé en direct', {}, { timeout: 1500 })).toBeInTheDocument();
  });
});
