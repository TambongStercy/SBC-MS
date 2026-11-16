/**
 * SMS packs are for Cameroonian parrains only (Rufus, 2026-10-05). SMS relance
 * only ever goes to +237 numbers, so before this check a parrain in Benin or
 * Togo could pay for SMS credits that could never be used (5 of the first 7
 * SMS buyers).
 *
 * The route is mounted for real and called over HTTP; who the buyer is and
 * payment-service are mocked.
 */
const getMemberCountry = jest.fn();
jest.mock('../services/clients/user.service.client', () => ({
    userServiceClient: { getMemberCountry: (...a: unknown[]) => getMemberCountry(...a) },
}));
const axiosPost = jest.fn();
jest.mock('axios', () => {
    const actual = jest.requireActual('axios');
    return { ...actual, __esModule: true, default: { ...actual.default, post: (...a: unknown[]) => axiosPost(...a) } };
});

import express from 'express';
import http from 'http';
import { AddressInfo } from 'net';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import config from '../config';
import relanceRoutes from '../api/routes/relance.routes';

let server: http.Server;
let base: string;
const buyer = new mongoose.Types.ObjectId().toString();
const token = jwt.sign({ userId: buyer, id: buyer, email: 'parrain@example.com', role: 'user' }, config.jwt.secret, { expiresIn: '1h' });

const buy = async (packId: string) => {
    const res = await fetch(`${base}/api/relance/packs/purchase`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ packId }),
    });
    return { status: res.status, json: await res.json().catch(() => null) as any };
};

beforeAll(() => {
    const app = express();
    app.use(express.json());
    app.use('/api/relance', relanceRoutes);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => { server?.close(); });
beforeEach(() => {
    getMemberCountry.mockReset();
    axiosPost.mockReset();
    axiosPost.mockResolvedValue({ data: { success: true, data: { sessionId: 'S1', checkoutUrl: 'https://pay.example/S1' } } });
});

describe('buying an SMS pack', () => {
    it('is refused outside Cameroon, before any payment is created', async () => {
        getMemberCountry.mockResolvedValue('BJ');
        const r = await buy('sms_250');
        expect(r.status).toBe(403);
        expect(r.json.message).toMatch(/réservés aux membres du Cameroun/);
        expect(axiosPost).not.toHaveBeenCalled();
    });

    it('goes ahead for a Cameroonian parrain (country stored as CM or a legacy name)', async () => {
        for (const country of ['CM', 'Cameroun', 'cameroon']) {
            getMemberCountry.mockResolvedValueOnce(country);
            const r = await buy('sms_250');
            expect(r.status).not.toBe(403);
        }
        expect(axiosPost).toHaveBeenCalledTimes(3);
    });

    it('waits when the country cannot be checked, rather than guessing', async () => {
        getMemberCountry.mockResolvedValue(null);
        const r = await buy('sms_1k');
        expect(r.status).toBe(503);
        expect(axiosPost).not.toHaveBeenCalled();
    });

    it('never asks for the country of an email pack', async () => {
        await buy('email_3k');
        expect(getMemberCountry).not.toHaveBeenCalled();
        expect(axiosPost).toHaveBeenCalledTimes(1);
    });
});
