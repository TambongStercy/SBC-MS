/**
 * Phase 1 e2e: LOVE conversation internal endpoint + encryption at rest.
 * Run: docker exec chat_service npx ts-node src/scripts/e2e-love-phase1.ts
 * Deleted after the phase — not part of the shipped service.
 */
import mongoose, { Types } from 'mongoose';
import axios from 'axios';
import connectDB from '../database/connection';
import config from '../config';
import { messageRepository } from '../database/repositories/message.repository';
import { messageService } from '../services/message.service';
import { encrypt } from '../utils/loveCrypto';
import ConversationModel from '../database/models/conversation.model';
import MessageModel, { MessageType, MessageStatus } from '../database/models/message.model';

function assert(cond: any, label: string) {
    if (!cond) throw new Error(`FAIL: ${label}`);
    console.log(`  ok: ${label}`);
}

async function main() {
    await connectDB();
    const userA = new Types.ObjectId().toString();
    const userB = new Types.ObjectId().toString();
    const matchId = new Types.ObjectId().toString();

    const url = `http://localhost:${config.port}/api/chat/internal/love-conversation`;
    const headers = { Authorization: `Bearer ${config.services.serviceSecret}`, 'X-Service-Name': 'e2e' };

    // 1. Internal endpoint: get-or-create is idempotent per matchId
    const r1 = await axios.post(url, { userId1: userA, userId2: userB, matchId }, { headers });
    const r2 = await axios.post(url, { userId1: userA, userId2: userB, matchId }, { headers });
    const convId = r1.data.data.conversationId;
    assert(convId, 'internal endpoint returns conversationId');
    assert(convId === r2.data.data.conversationId, 'get-or-create idempotent (same id twice)');

    // 2. Auth: wrong service secret is rejected
    let rejected = false;
    try {
        await axios.post(url, { userId1: userA, userId2: userB, matchId }, { headers: { Authorization: 'Bearer wrong' } });
    } catch (e: any) {
        rejected = e.response?.status === 403;
    }
    assert(rejected, 'wrong service secret rejected (403)');

    // 3. Conversation stored as LOVE + pre-ACCEPTED with matchId
    const conv = await ConversationModel.findById(convId).lean();
    assert(conv?.type === 'love', 'conversation type is love');
    assert(conv?.acceptanceStatus === 'accepted', 'love conversation pre-accepted');
    assert(conv?.matchId?.toString() === matchId, 'matchId stored on conversation');

    // 4. Encryption at rest + decrypt on read
    const secret = 'rendez-vous mercredi 💙 secretword';
    const msg = await messageRepository.create({
        conversationId: new Types.ObjectId(convId),
        senderId: new Types.ObjectId(userA),
        content: encrypt(secret),
        encrypted: true,
        type: MessageType.TEXT,
        status: MessageStatus.SENT,
        readBy: [new Types.ObjectId(userA)],
        deliveredTo: [new Types.ObjectId(userA)]
    });

    const raw = await MessageModel.collection.findOne({ _id: msg._id });
    assert(typeof raw?.content === 'string' && raw!.content.startsWith('enc:v1:'), 'ciphertext stored at rest');
    assert(!raw!.content.includes('secretword'), 'plaintext absent from DB at rest');

    const read = await messageService.getConversationMessages(convId, userA, 1, 50);
    const got = read.messages.find(m => m._id.toString() === msg._id.toString());
    assert(got?.content === secret, 'content decrypted on read');

    // cleanup
    await MessageModel.deleteMany({ conversationId: convId });
    await ConversationModel.deleteOne({ _id: convId });

    console.log('PHASE 1 E2E OK');
    await mongoose.disconnect();
    process.exit(0); // presence-service holds an open Redis handle otherwise
}

main().catch(async (e) => {
    console.error(e.message || e);
    await mongoose.disconnect();
    process.exit(1);
});
