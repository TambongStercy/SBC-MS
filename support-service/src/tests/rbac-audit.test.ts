import mongoose from 'mongoose';
import { AuditLog } from '../database/models/audit-log.model';
import { audit, verifyAuditChain } from '../services/audit.service';
import { desk, login, makeAgent, mockFetch, setupDb, teardown } from './helpers';

beforeEach(setupDb);
afterAll(teardown);

describe('RBAC', () => {
    it('refuses a verifier on a finance route and writes the refusal to the audit', async () => {
        const fetchMock = mockFetch({});
        try {
            const v = await makeAgent(['verifier']);
            const jar = await login(v);
            const r = await desk('get', '/finance/summary', jar);
            expect(r.status).toBe(403);
            await new Promise((res) => setTimeout(res, 100));
            const entry = await AuditLog.findOne({ action: 'access.denied', 'actor.id': v.id }).lean();
            expect(entry).toBeTruthy();
            expect(entry!.result).toBe('denied');
            expect((entry!.meta as any).missing).toEqual(['finance.read']);
            expect((entry!.meta as any).path).toBe('/api/support/desk/finance/summary');
            // Nothing reached payment-service.
            expect(fetchMock.calls).toHaveLength(0);
        } finally {
            fetchMock.restore();
        }
    });

    it('gives each role exactly the contract permissions', async () => {
        const { permissionsFor } = await import('../config/permissions');
        expect(permissionsFor(['verifier'])).toEqual(['views.verify']);
        expect(permissionsFor(['finance_agent'])).not.toContain('finance.regularize.approve');
        expect(permissionsFor(['finance_manager'])).toContain('finance.regularize.approve');
        expect(permissionsFor(['support_admin'])).not.toContain('finance.regularize.request');
        expect(permissionsFor(['support_agent'])).toContain('members.contact.request');
        expect(permissionsFor(['support_agent'])).not.toContain('members.read.full');
    });
});

describe('audit chain', () => {
    it('stays linear under concurrent appends and detects a tampered row', async () => {
        await Promise.all(Array.from({ length: 40 }, (_, i) => audit({ actor: { type: 'system' }, action: 'test.event', meta: { i, nested: { b: 2, a: [1, { z: true }] } } })));
        const ok = await verifyAuditChain();
        expect(ok).toEqual({ ok: true, count: 40 });
        const seqs = (await AuditLog.find({}, { seq: 1 }).sort({ seq: 1 }).lean()).map((d) => d.seq);
        expect(seqs).toEqual(Array.from({ length: 40 }, (_, i) => i + 1));

        // The model refuses updates and deletes.
        await expect(AuditLog.updateOne({ seq: 3 }, { $set: { action: 'x' } })).rejects.toThrow(/append-only/);
        await expect(AuditLog.deleteOne({ seq: 3 })).rejects.toThrow(/append-only/);

        // Tampering through the raw driver is detected.
        await mongoose.connection.collection('auditlogs').updateOne({ seq: 17 }, { $set: { 'meta.i': 999 } });
        const bad = await verifyAuditChain();
        expect(bad.ok).toBe(false);
        expect(bad.firstBadSeq).toBe(17);
    });

    it('detects a deleted row', async () => {
        for (let i = 0; i < 5; i++) await audit({ actor: { type: 'system' }, action: 'test.event', meta: { i } });
        await mongoose.connection.collection('auditlogs').deleteOne({ seq: 3 });
        const r = await verifyAuditChain();
        expect(r.ok).toBe(false);
        expect(r.firstBadSeq).toBe(3);
    });
});
