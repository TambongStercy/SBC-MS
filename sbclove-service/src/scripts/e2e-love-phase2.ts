/**
 * Phase 2 e2e: match chat-open endpoint + internal can-chat/window.
 * Run: docker exec sbclove_service npx ts-node src/scripts/e2e-love-phase2.ts
 * Deleted after the phase — not part of the shipped service.
 */
import mongoose, { Types } from 'mongoose';
import axios from 'axios';
import jwt from 'jsonwebtoken';
import connectDB from '../database/connection';
import config from '../config';
import { matchRepository } from '../database/repositories/match.repository';
import MatchModel from '../database/models/match.model';

function assert(cond: any, label: string) {
    if (!cond) throw new Error(`FAIL: ${label}`);
    console.log(`  ok: ${label}`);
}

const base = `http://localhost:${config.port}/api`;
const svcHeaders = { Authorization: `Bearer ${config.services.serviceSecret}`, 'X-Service-Name': 'e2e' };
const userJwt = (userId: string) => jwt.sign({ userId, id: userId, email: `${userId}@e2e.test`, role: 'user' }, config.jwt.secret);

async function main() {
    await connectDB();
    const userA = new Types.ObjectId().toString();
    const userB = new Types.ObjectId().toString();
    const stranger = new Types.ObjectId().toString();

    const { match } = await matchRepository.createOrGet(userA, userB);
    const matchId = match._id.toString();

    // 1. Internal window endpoint
    const win = await axios.get(`${base}/sbclove/internal/window`, { headers: svcHeaders });
    assert(typeof win.data.data.isOpen === 'boolean', 'internal /window returns isOpen boolean');
    const isOpen = win.data.data.isOpen;

    // 2. can-chat: locked match → unlocked:false
    const cc1 = await axios.get(`${base}/sbclove/internal/can-chat`, { headers: svcHeaders, params: { matchId, userId: userA } });
    assert(cc1.data.data.unlocked === false, 'can-chat unlocked=false before contact unlock');
    assert(cc1.data.data.isOpen === isOpen, 'can-chat isOpen matches /window');

    // 3. POST /matches/:id/chat on a LOCKED match → 403
    let locked403 = false;
    try {
        await axios.post(`${base}/sbclove/matches/${matchId}/chat`, {}, { headers: { Authorization: `Bearer ${userJwt(userA)}` } });
    } catch (e: any) { locked403 = e.response?.status === 403; }
    assert(locked403, 'open chat on locked match rejected (403)');

    // Unlock contact (simulate double opt-in)
    await MatchModel.updateOne({ _id: matchId }, { contactUnlocked: true, contactUnlockedAt: new Date() });

    // 4. can-chat now unlocked:true
    const cc2 = await axios.get(`${base}/sbclove/internal/can-chat`, { headers: svcHeaders, params: { matchId, userId: userA } });
    assert(cc2.data.data.unlocked === true, 'can-chat unlocked=true after contact unlock');

    // 5. non-participant cannot open → 404
    let stranger404 = false;
    try {
        await axios.post(`${base}/sbclove/matches/${matchId}/chat`, {}, { headers: { Authorization: `Bearer ${userJwt(stranger)}` } });
    } catch (e: any) { stranger404 = e.response?.status === 404; }
    assert(stranger404, 'non-participant open chat rejected (404)');

    // 6. participant opens chat → conversationId, idempotent (calls chat-service)
    const o1 = await axios.post(`${base}/sbclove/matches/${matchId}/chat`, {}, { headers: { Authorization: `Bearer ${userJwt(userA)}` } });
    const o2 = await axios.post(`${base}/sbclove/matches/${matchId}/chat`, {}, { headers: { Authorization: `Bearer ${userJwt(userB)}` } });
    const convId = o1.data.data.conversationId;
    assert(!!convId, 'open chat returns conversationId');
    assert(convId === o2.data.data.conversationId, 'both participants get the same conversation (idempotent)');

    // 7. missing auth rejected
    let noAuth = false;
    try { await axios.post(`${base}/sbclove/matches/${matchId}/chat`, {}); }
    catch (e: any) { noAuth = e.response?.status === 401; }
    assert(noAuth, 'open chat without JWT rejected (401)');

    // 8. internal endpoints require service secret
    let noSvc = false;
    try { await axios.get(`${base}/sbclove/internal/window`); }
    catch (e: any) { noSvc = e.response?.status === 401; }
    assert(noSvc, 'internal endpoint without service secret rejected (401)');

    // cleanup
    await MatchModel.deleteOne({ _id: matchId });

    console.log('PHASE 2 E2E OK');
    await mongoose.disconnect();
    process.exit(0);
}

main().catch(async (e) => {
    console.error(e.response?.data || e.message || e);
    await mongoose.disconnect();
    process.exit(1);
});
