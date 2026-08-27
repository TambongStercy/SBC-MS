/**
 * Functional check of the SBC Love admin console — every call the page makes,
 * in the order an admin makes them, through the API gateway.
 *
 * Seeds its own throwaway members so it can assert on real numbers (a pending
 * profile to validate, a match, a match with a conversation), then removes them.
 *
 * Run (local dev): npx ts-node src/scripts/e2e-admin-console.ts
 */
import mongoose, { Types } from 'mongoose';
import axios from 'axios';
import jwt from 'jsonwebtoken';
import connectDB from '../database/connection';
import config from '../config';
import LoveProfileModel from '../database/models/love-profile.model';
import MatchModel from '../database/models/match.model';
import { loveProfileRepository } from '../database/repositories/love-profile.repository';
import { matchRepository } from '../database/repositories/match.repository';
import { Intention, ProfileStatus, ContactChoice } from '../types/sbclove.enums';

function assert(cond: any, label: string) {
    if (!cond) throw new Error(`FAIL: ${label}`);
    console.log(`  ok: ${label}`);
}

// Through the gateway, exactly like the admin frontend (VITE_API_URL).
const GW = 'http://localhost:3000/api';
const admin = (id: string) => ({
    headers: { Authorization: `Bearer ${jwt.sign({ userId: id, id, email: 'admin@e2e.test', role: 'admin' }, config.jwt.secret)}` },
});
const USERS_DB = 'mongodb://127.0.0.1:27017/sbc_user_dev';
const TAG = '[e2e-admin]';

async function main() {
    await connectDB();
    const users = await mongoose.createConnection(USERS_DB).asPromise();
    const adminId = new Types.ObjectId().toString();

    // Three members: one pending with a single photo (below the minimum), and a
    // matched pair — one of whose match already has a conversation.
    const [pendingId, aId, bId] = [1, 2, 3].map(() => new Types.ObjectId());
    const photo = (n: number) => ({ fileId: `sbclove/${n}_photo.jpg`, blurredFileId: `sbclove/${n}_blur.jpg`, order: 0 });

    // Re-runnable: clear anything a previous run left behind (email and phone
    // are uniquely indexed, so leftovers would collide forever).
    const leftovers = await users.collection('users').find({ name: new RegExp('e2e-admin') }).toArray();
    if (leftovers.length) {
        const ids = leftovers.map(u => u._id as Types.ObjectId);
        await MatchModel.deleteMany({ $or: [{ userA: { $in: ids } }, { userB: { $in: ids } }] });
        await LoveProfileModel.deleteMany({ userId: { $in: ids } });
        await users.collection('users').deleteMany({ _id: { $in: ids } });
    }

    // phoneNumber is uniquely indexed in user-service, so each seed needs its own.
    await users.collection('users').insertMany([
        { _id: pendingId, name: `Pending ${TAG}`, email: 'pending@e2e.test', phoneNumber: '+237699000001', sex: 'female', city: 'Douala', isVerified: true, createdAt: new Date(), role: 'user' },
        { _id: aId, name: `Alpha ${TAG}`, email: 'alpha@e2e.test', phoneNumber: '+237699000002', sex: 'male', city: 'Yaoundé', isVerified: true, createdAt: new Date(), role: 'user' },
        { _id: bId, name: `Beta ${TAG}`, email: 'beta@e2e.test', phoneNumber: '+237699000003', sex: 'female', city: 'Kribi', isVerified: true, createdAt: new Date(), role: 'user' },
    ] as any);

    const pending = await loveProfileRepository.create({
        userId: pendingId, displayName: `Pending ${TAG}`, intention: Intention.MARRIAGE_PROJECT,
        description: 'En attente de validation.', sex: 'female', photos: [photo(1)], status: ProfileStatus.PENDING,
    } as any);
    for (const [id, sex] of [[aId, 'male'], [bId, 'female']] as const) {
        await loveProfileRepository.create({
            userId: id, displayName: `${sex === 'male' ? 'Alpha' : 'Beta'} ${TAG}`, intention: Intention.GET_ACQUAINTED,
            description: 'Profil apparié.', sex, photos: [photo(2), { ...photo(3), order: 1 }], status: ProfileStatus.APPROVED,
        } as any);
    }
    const { match } = await matchRepository.createOrGet(aId.toString(), bId.toString());
    await MatchModel.updateOne({ _id: match._id }, {
        contactUnlocked: true,
        conversationId: 'conv-e2e-admin',
        chatOpenedAt: new Date(),
        participants: [{ userId: aId, choice: ContactChoice.WANTS_CONTACT }, { userId: bId, choice: ContactChoice.WANTS_CONTACT }],
    });

    try {
        // 1. Dashboard totals — the figures on top of the Membres tab.
        const stats = (await axios.get(`${GW}/sbclove/admin/stats`, admin(adminId))).data.data;
        assert(stats.profiles.total >= 3 && stats.profiles.pending >= 1, 'stats: profiles counted by status');
        assert(stats.matches.total >= 1, 'stats: matches counted');
        assert(stats.matches.conversations >= 1, 'stats: started conversations counted');
        assert(typeof stats.interests.total === 'number' && typeof stats.reports.open === 'number', 'stats: interests and open reports counted');

        // 2. Member directory — the new tab, with per-member tallies.
        const dir = (await axios.get(`${GW}/sbclove/admin/members?limit=100`, admin(adminId))).data;
        const alpha = dir.data.find((m: any) => m.userId === aId.toString());
        assert(dir.pagination.totalPages >= 1 && dir.pagination.total === dir.pagination.total, 'members: pagination metadata present');
        assert(!!alpha, 'members: every SBCLOVE member is listed');
        assert(alpha.memberEmail === 'alpha@e2e.test' && alpha.city === 'Yaoundé', 'members: hydrated with the SBC account');
        assert(alpha.matches === 1, 'members: match count per member');
        assert(alpha.conversations === 1, 'members: started-conversation count per member');
        assert(alpha.photoCount === 2, 'members: photo count per member');

        // 3. Pagination actually pages: two pages of 1 must differ.
        const p1 = (await axios.get(`${GW}/sbclove/admin/members?limit=1&page=1`, admin(adminId))).data;
        const p2 = (await axios.get(`${GW}/sbclove/admin/members?limit=1&page=2`, admin(adminId))).data;
        assert(p1.data.length === 1 && p2.data.length === 1, 'pagination: one row per page at limit=1');
        assert(p1.data[0]._id !== p2.data[0]._id, 'pagination: page 2 returns different members');
        assert(p1.pagination.totalPages === p1.pagination.total, 'pagination: totalPages matches the row count at limit=1');

        // 4. Validation queue, filtered like the Profils tab does.
        const queue = (await axios.get(`${GW}/sbclove/admin/profiles?status=pending&limit=50`, admin(adminId))).data;
        const row = queue.data.find((p: any) => p._id === pending._id.toString());
        assert(!!row, 'queue: the pending profile is listed');
        assert(row.meetsPhotoRequirement === false && row.photoCount === 1, 'queue: flags the profile below the photo minimum');

        // 5. Approve is refused, reject with a reason works, and the reason sticks.
        let refused = 0;
        try {
            await axios.patch(`${GW}/sbclove/admin/profiles/${row._id}/validate`, { approve: true }, admin(adminId));
        } catch (e: any) { refused = e.response?.status; }
        assert(refused === 400, 'validate: approving below the photo minimum is refused');

        await axios.patch(`${GW}/sbclove/admin/profiles/${row._id}/validate`, { approve: false, rejectionReason: 'Photo en pied manquante' }, admin(adminId));
        const rejected = (await axios.get(`${GW}/sbclove/admin/profiles?status=rejected&limit=50`, admin(adminId))).data
            .data.find((p: any) => p._id === row._id);
        assert(rejected?.moderation.rejectionReason === 'Photo en pied manquante', 'validate: rejection reason recorded');

        // 6. Approve a complete profile, then suspend and reinstate it.
        const alphaProfileId = alpha._id;
        await axios.patch(`${GW}/sbclove/admin/profiles/${alphaProfileId}/suspension`, { suspend: true, reason: 'test' }, admin(adminId));
        let after = (await axios.get(`${GW}/sbclove/admin/members?limit=100`, admin(adminId))).data
            .data.find((m: any) => m._id === alphaProfileId);
        assert(after.status === 'suspended', 'suspension: profile suspended');

        await axios.patch(`${GW}/sbclove/admin/profiles/${alphaProfileId}/suspension`, { suspend: false }, admin(adminId));
        after = (await axios.get(`${GW}/sbclove/admin/members?limit=100`, admin(adminId))).data
            .data.find((m: any) => m._id === alphaProfileId);
        assert(after.status === 'approved' && after.reportCount === 0, 'suspension: reinstating restores approval and clears reports');

        // 7. Reports tab + the module config the Configuration tab writes.
        const reports = (await axios.get(`${GW}/sbclove/admin/reports?limit=10`, admin(adminId))).data;
        assert(Array.isArray(reports.data) && Number.isInteger(reports.pagination.totalPages), 'reports: list paginates');

        const cfg = (await axios.get(`${GW}/sbclove/admin/module`, admin(adminId))).data.data;
        const saved = (await axios.patch(`${GW}/sbclove/admin/module`, { maxInterestsPerWeek: cfg.maxInterestsPerWeek }, admin(adminId))).data.data;
        assert(saved.maxInterestsPerWeek === cfg.maxInterestsPerWeek, 'config: reads back what it writes');

        // 8. A non-admin must not reach any of it.
        let forbidden = 0;
        try {
            await axios.get(`${GW}/sbclove/admin/members`, {
                headers: { Authorization: `Bearer ${jwt.sign({ userId: aId.toString(), id: aId.toString(), role: 'user' }, config.jwt.secret)}` },
            });
        } catch (e: any) { forbidden = e.response?.status; }
        assert(forbidden === 403 || forbidden === 401, 'authorization: a plain member cannot read the admin console');

        console.log('\nadmin console checks passed');
    } finally {
        await MatchModel.deleteMany({ $or: [{ userA: { $in: [aId, bId] } }, { userB: { $in: [aId, bId] } }] });
        await LoveProfileModel.deleteMany({ userId: { $in: [pendingId, aId, bId] } });
        await users.collection('users').deleteMany({ _id: { $in: [pendingId, aId, bId] } });
        await users.close();
    }
}

main()
    .catch((e) => { console.error(e.message || e); process.exitCode = 1; })
    .finally(() => mongoose.disconnect());
