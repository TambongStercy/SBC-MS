/**
 * Phase 3 e2e: full flow through the gateway — the exact API chain the frontend
 * drives. open chat → send (window open) → read decrypted → verify ciphertext at
 * rest → window closed → send rejected. Restores the window afterwards.
 * Run: docker exec sbclove_service npx ts-node src/scripts/e2e-love-phase3.ts
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

const GW = 'http://gateway-service:3000/api';
const userJwt = (userId: string, role = 'user') =>
    jwt.sign({ userId, id: userId, email: `${userId}@e2e.test`, role }, config.jwt.secret);
const auth = (uid: string, role = 'user') => ({ headers: { Authorization: `Bearer ${userJwt(uid, role)}` } });

// Current weekday in the SBCLOVE timezone (so the window can be opened/closed deterministically).
function doualaWeekday(): number {
    const wd = new Intl.DateTimeFormat('en-US', { timeZone: config.sbclove.timezone, weekday: 'short' }).format(new Date());
    return ({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 } as Record<string, number>)[wd];
}

async function setWindow(adminUid: string, params: object) {
    // Admin PATCH invalidates the service's in-process config cache immediately.
    await axios.patch(`${GW}/sbclove/admin/module`, params, auth(adminUid, 'admin'));
}

async function main() {
    await connectDB();
    const chatConn = await mongoose.createConnection('mongodb://mongo:27017/sbc_chat_dev').asPromise();

    const userA = new Types.ObjectId().toString();
    const userB = new Types.ObjectId().toString();
    const admin = new Types.ObjectId().toString();
    const today = doualaWeekday();

    // Unlocked match
    const { match } = await matchRepository.createOrGet(userA, userB);
    const matchId = match._id.toString();
    await MatchModel.updateOne({ _id: matchId }, { contactUnlocked: true, contactUnlockedAt: new Date() });

    // Window OPEN today, all day
    await setWindow(admin, { enabled: true, activeWeekday: today, openHour: 0, closeHour: 23 });

    // 1. Open chat (frontend "Discuter")
    const open = await axios.post(`${GW}/sbclove/matches/${matchId}/chat`, {}, auth(userA));
    const conversationId = open.data.data.conversationId;
    assert(!!conversationId, 'open chat returns conversationId (via gateway)');

    // 2. Send during open window
    const secret = 'secretword-' + matchId.slice(-6);
    const sent = await axios.post(`${GW}/chat/messages`, { conversationId, content: `rdv mercredi 💙 ${secret}` }, auth(userA));
    assert(sent.status === 201, 'message sent during window (201)');

    // 3. Read back decrypted (other participant)
    const read = await axios.get(`${GW}/chat/conversations/${conversationId}/messages`, auth(userB));
    const msgs = read.data?.data?.messages ?? read.data?.data ?? [];
    const got = msgs.find((m: any) => typeof m.content === 'string' && m.content.includes(secret));
    assert(!!got, 'message read back decrypted by the other participant');

    // 4. Ciphertext at rest in the chat DB
    const raw = await chatConn.collection('messages').findOne({ _id: new Types.ObjectId(got._id) });
    assert(typeof raw?.content === 'string' && raw!.content.startsWith('enc:v1:'), 'stored ciphertext at rest');
    assert(!raw!.content.includes(secret), 'plaintext absent from chat DB at rest');

    // 5. Window CLOSED (different active weekday) → send rejected
    await setWindow(admin, { enabled: true, activeWeekday: (today + 1) % 7, openHour: 0, closeHour: 23 });
    let rejected = false;
    try {
        await axios.post(`${GW}/chat/messages`, { conversationId, content: 'should fail' }, auth(userA));
    } catch (e: any) {
        rejected = (e.response?.status ?? 0) >= 400;
    }
    assert(rejected, 'send rejected outside the weekly window (read-only)');

    // 6. History still readable when closed
    const readClosed = await axios.get(`${GW}/chat/conversations/${conversationId}/messages`, auth(userB));
    const msgsClosed = readClosed.data?.data?.messages ?? readClosed.data?.data ?? [];
    assert(msgsClosed.some((m: any) => m.content?.includes(secret)), 'history still readable when window closed');

    // Restore window open + cleanup
    await setWindow(admin, { enabled: true, activeWeekday: today, openHour: 0, closeHour: 23 });
    await chatConn.collection('messages').deleteMany({ conversationId: new Types.ObjectId(conversationId) });
    await chatConn.collection('conversations').deleteOne({ _id: new Types.ObjectId(conversationId) });
    await MatchModel.deleteOne({ _id: matchId });

    console.log('PHASE 3 E2E OK');
    await chatConn.close();
    await mongoose.disconnect();
    process.exit(0);
}

main().catch(async (e) => {
    console.error(e.response?.data || e.message || e);
    await mongoose.disconnect();
    process.exit(1);
});
