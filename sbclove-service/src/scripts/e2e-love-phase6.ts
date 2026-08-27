/**
 * Phase 6 check: the contract the frontend actually consumes.
 *
 * Covers what the SBC Love UI depends on and what a path-param photo id could
 * never carry: the module status payload driving the Home tile, browser-reachable
 * photo URLs, the deck hiding anyone already dealt with, and photo deletion by a
 * slash-bearing GCS object name.
 *
 * Run (local dev): npx ts-node src/scripts/e2e-love-phase6.ts
 */
import mongoose, { Types } from 'mongoose';
import axios from 'axios';
import jwt from 'jsonwebtoken';
import connectDB from '../database/connection';
import config from '../config';
import { loveProfileRepository } from '../database/repositories/love-profile.repository';
import { moduleConfigRepository } from '../database/repositories/module-config.repository';
import LoveProfileModel from '../database/models/love-profile.model';
import InterestModel from '../database/models/interest.model';
import { Intention, ProfileStatus } from '../types/sbclove.enums';

function assert(cond: any, label: string) {
    if (!cond) throw new Error(`FAIL: ${label}`);
    console.log(`  ok: ${label}`);
}

const base = `http://localhost:${config.port}/api`;
const auth = (userId: string, role = 'user') => ({
    headers: { Authorization: `Bearer ${jwt.sign({ userId, id: userId, email: `${userId}@e2e.test`, role }, config.jwt.secret)}` },
});

// The window has to move through the admin endpoint, not the repository: the
// running service caches the module config in-process, and only the admin PATCH
// invalidates that cache. A direct DB write would leave the service on the old
// window and the gate would not budge.
const setWindow = (adminId: string, params: object) =>
    axios.patch(`${base}/sbclove/admin/module`, params, auth(adminId, 'admin'));

// A real settings-service id: folder prefix + slash. This is the shape that
// broke `DELETE /me/photos/:fileId`.
const PHOTO_ID = 'sbclove/1712345678_photo.jpg';
const BLURRED_ID = 'sbclove/1712345678_blurred.jpg';

// memberSince comes from the SBC account, not from the SBCLOVE profile, so the
// check needs a real user record to hydrate from.
const USERS_DB = 'mongodb://127.0.0.1:27017/sbc_user_dev';
const JOINED_AT = new Date('2024-03-15T10:00:00.000Z');

async function main() {
    await connectDB();
    const userId = new Types.ObjectId().toString();
    const otherId = new Types.ObjectId().toString();   // opposite sex — must be proposed
    const sameSexId = new Types.ObjectId().toString(); // same sex — must never be
    const adminId = new Types.ObjectId().toString();

    const users = await mongoose.createConnection(USERS_DB).asPromise();
    await users.collection('users').insertOne({
        _id: new Types.ObjectId(userId), name: 'E2E Phase6', email: `${userId}@e2e.test`,
        role: 'user', isVerified: true, sex: 'male', city: 'Douala', country: 'CM', createdAt: JOINED_AT, updatedAt: JOINED_AT,
    } as any);

    await loveProfileRepository.create({
        userId: new Types.ObjectId(userId),
        intention: Intention.GET_ACQUAINTED,
        description: 'Profil e2e phase 6.',
        sex: 'male',
        photos: [{ fileId: PHOTO_ID, blurredFileId: BLURRED_ID, order: 0 }],
        status: ProfileStatus.APPROVED,
    } as any);

    // A second approved profile, to prove the deck drops what you acted on.
    const other = await loveProfileRepository.create({
        userId: new Types.ObjectId(otherId),
        displayName: 'E2E Phase6 Other',
        intention: Intention.GET_ACQUAINTED,
        description: 'Deuxième profil e2e.',
        sex: 'female',
        photos: [{ fileId: PHOTO_ID, blurredFileId: BLURRED_ID, order: 0 }],
        status: ProfileStatus.APPROVED,
    } as any);

    const sameSex = await loveProfileRepository.create({
        userId: new Types.ObjectId(sameSexId),
        displayName: 'E2E Phase6 Same Sex',
        intention: Intention.GET_ACQUAINTED,
        description: 'Profil du même sexe que le viewer.',
        sex: 'male',
        photos: [{ fileId: PHOTO_ID, blurredFileId: BLURRED_ID, order: 0 }],
        status: ProfileStatus.APPROVED,
    } as any);

    // Browsing is window-gated, so the test drives the window itself and puts
    // the admin's setting back afterwards.
    const savedWindow = await moduleConfigRepository.get();

    try {
        // 1. Status payload — every field the Home tile's display rules read.
        const status = (await axios.get(`${base}/sbclove/status`, auth(userId))).data.data;
        assert(typeof status.enabled === 'boolean', 'status.enabled is a boolean (kill-switch)');
        assert(typeof status.isOpen === 'boolean', 'status.isOpen is a boolean (weekly window)');
        assert(Number.isInteger(status.activeWeekday) && status.activeWeekday >= 0 && status.activeWeekday <= 6, 'status.activeWeekday is a weekday index');
        assert(Number.isInteger(status.openHour) && Number.isInteger(status.closeHour), 'status carries the open/close hours');
        assert(status.minPhotos >= 2 && status.maxPhotos >= status.minPhotos, 'status carries the photo requirement (min 2)');

        // 2. Photos must be reachable from a browser, not from an internal host.
        const me = (await axios.get(`${base}/sbclove/profiles/me`, auth(userId))).data.data;
        assert(/^https?:\/\//.test(me.photos[0].url), 'photo url is absolute and public');
        assert(!me.photos[0].url.includes('localhost:3007'), 'photo url is not the internal settings-service address');
        assert(me.photos[0].fileId === PHOTO_ID, 'photo fileId is exposed verbatim (slash included)');
        assert(new Date(me.memberSince).getTime() === JOINED_AT.getTime(), 'profile carries memberSince (the SBC join date)');

        // 3. Browsing is window-gated: outside the session it must answer 423.
        await setWindow(adminId, { enabled: true, activeWeekday: 0, openHour: 0, closeHour: 0 });
        let browseStatus = 200;
        try {
            await axios.get(`${base}/sbclove/profiles`, auth(userId));
        } catch (e: any) { browseStatus = e.response?.status; }
        assert(browseStatus === 423, 'browse locked (423) while the session is closed');

        // 4. Open it: the deck shows a fresh profile, and hides it once you have
        //    expressed interest — which is also every profile you matched with.
        await setWindow(adminId, { enabled: true, activeWeekday: new Date().getUTCDay(), openHour: 0, closeHour: 24 });
        const before = (await axios.get(`${base}/sbclove/profiles`, auth(userId))).data.data as { id: string }[];
        assert(before.some(p => p.id === other._id.toString()), 'a fresh profile of the opposite sex shows up in the deck');
        assert(!before.some(p => p.id === sameSex._id.toString()), 'a profile of the SAME sex is never proposed');

        // Even hand-crafted, the write path refuses a same-sex interest.
        let sameSexInterest = 0;
        try {
            await axios.post(`${base}/sbclove/profiles/${sameSex._id}/interest`, {}, auth(userId));
        } catch (e: any) { sameSexInterest = e.response?.status; }
        assert(sameSexInterest === 404, 'expressing interest in the same sex is rejected (404)');

        await InterestModel.create({ fromUserId: new Types.ObjectId(userId), toUserId: new Types.ObjectId(otherId), sessionDate: '2026-01-01' });
        const after = (await axios.get(`${base}/sbclove/profiles`, auth(userId))).data.data as { id: string }[];
        assert(!after.some(p => p.id === other._id.toString()), 'a profile you already liked (or matched) is gone from the deck');

        // 5. The admin validation queue must be judgeable: clear photo urls, the
        //    member behind the profile, and the photo rule stated up front.
        const queue = (await axios.get(`${base}/sbclove/admin/profiles?limit=50`, auth(adminId, 'admin'))).data;
        const mine = (queue.data as any[]).find(p => p.userId === userId);
        assert(Number.isInteger(queue.pagination.totalPages), 'admin queue reports totalPages (pagination works)');
        assert(!!mine && /^https?:\/\//.test(mine.photos[0].url) && mine.photos[0].blurred === false, 'admin sees CLEAR photo urls');
        assert(mine.memberName === 'E2E Phase6' && mine.memberEmail === `${userId}@e2e.test`, 'admin sees the SBC member behind the profile');
        assert(mine.photoCount === 1 && mine.minPhotos >= 2 && mine.meetsPhotoRequirement === false, 'admin queue flags a profile below the photo minimum');

        // 6. And approval is actually refused below that minimum.
        let approveBelowMin = 0;
        try {
            await axios.patch(`${base}/sbclove/admin/profiles/${mine._id}/validate`, { approve: true }, auth(adminId, 'admin'));
        } catch (e: any) { approveBelowMin = e.response?.status; }
        assert(approveBelowMin === 400, 'approving a profile with too few photos is rejected (400)');

        // 7. Deletion takes the id in the query — a path param cannot hold the
        //    slash, and the gateway proxy drops DELETE bodies.
        let missing = 0;
        try {
            await axios.delete(`${base}/sbclove/profiles/me/photos`, auth(userId));
        } catch (e: any) { missing = e.response?.status; }
        assert(missing === 400, 'delete without fileId rejected (400)');

        const afterDelete = (await axios.delete(
            `${base}/sbclove/profiles/me/photos?fileId=${encodeURIComponent(PHOTO_ID)}`,
            auth(userId),
        )).data.data;
        assert(afterDelete.photos.length === 0, 'photo deleted by its slash-bearing fileId');

        console.log('\nphase 6 checks passed');
    } finally {
        await setWindow(adminId, {
            enabled: savedWindow.enabled, activeWeekday: savedWindow.activeWeekday,
            openHour: savedWindow.openHour, closeHour: savedWindow.closeHour,
        });
        await InterestModel.deleteMany({ fromUserId: new Types.ObjectId(userId) });
        await LoveProfileModel.deleteMany({ userId: { $in: [userId, otherId, sameSexId].map(id => new Types.ObjectId(id)) } });
        await users.collection('users').deleteOne({ _id: new Types.ObjectId(userId) });
        await users.close();
    }
}

// No process.exit(): it drops whatever is still buffered on a pipe, which is
// exactly the failure message you need when a check fails.
main()
    .catch((e) => { console.error(e.message || e); process.exitCode = 1; })
    .finally(() => mongoose.disconnect());
