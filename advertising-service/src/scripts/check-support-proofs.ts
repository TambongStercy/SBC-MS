/**
 * Video proofs decided from SBC Support (contract §2.3), and the admin panel
 * made read-only.
 *
 *  - a decision is one conditional write: five at once → one success, four 409
 *    ALREADY_DECIDED, and the day credited once (the admin approve/reject used to
 *    read-then-write, so two reviewers could both credit the same day)
 *  - the admin panel's approve/reject answer 403 while
 *    VIDEO_VERIFICATION_ADMIN_READONLY is on, except for the super admin
 *    (role `admin`), whose override is recorded
 *  - only views_supervisor / support_admin can ban from SBC Support
 *  - a proof entering pending_review is sent to support-service, and the
 *    diffuseur's upload succeeds whether or not that call can be made
 *  - the internal list / detail and the admin list pagination
 *
 * Needs a local Mongo. Uses its own database (sbc_advertising_owner_test) and
 * drops it. Every outbound call (user-service, notification-service, settings)
 * is stubbed or pointed at a dead port: nothing real is reached.
 *
 *   npx ts-node src/scripts/check-support-proofs.ts
 */
import http from 'http';
import type { AddressInfo } from 'net';

const DEAD = 'http://127.0.0.1:9';
process.env.MONGODB_URI = process.env.SUPPORT_PROOFS_TEST_DB || 'mongodb://127.0.0.1:27017/sbc_advertising_owner_test';
process.env.USER_SERVICE_URL = DEAD;
process.env.NOTIFICATION_SERVICE_URL = DEAD;
process.env.SETTINGS_SERVICE_URL = DEAD;
process.env.PAYMENT_SERVICE_URL = DEAD;
process.env.JWT_SECRET = 'check-support-proofs-jwt';
process.env.SERVICE_SECRET = 'check-support-proofs-service';
delete process.env.SUPPORT_SERVICE_URL;
delete process.env.VIDEO_VERIFICATION_ADMIN_READONLY;

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failures++;
};

type Res = { status: number; body: any };

const main = async () => {
    const { default: mongoose, Types } = await import('mongoose');
    const { default: express } = await import('express');
    const jwt = (await import('jsonwebtoken')).default;
    if (!/_test$|owner_test/.test(process.env.MONGODB_URI!)) throw new Error('Refusing to run on a non-test database');

    // Stubs before the services load their bindings (property access at call time).
    const notif = await import('../services/clients/notification.service.client');
    const sentNotifications: string[] = [];
    (notif as any).notifyManualVerificationApproved = async (userId: string) => { sentNotifications.push(`approved:${userId}`); return true; };
    (notif as any).notifyManualVerificationRejected = async (userId: string) => { sentNotifications.push(`rejected:${userId}`); return true; };
    const users = await import('../services/clients/user.service.client');
    (users as any).getUserProfile = async (id: string) => ({ _id: id, name: 'Diffuseur Test', country: 'CM' });
    (users as any).getUserProfiles = async (ids: string[]) => ids.map(id => ({ _id: id, name: 'Diffuseur Test', country: 'CM' }));

    const { default: ManualVerificationModel, ManualVerificationStatus } = await import('../database/models/manual-verification.model');
    const { default: CampaignParticipationModel, ParticipationStatus, DayStatus } = await import('../database/models/campaign-participation.model');
    const { default: CampaignModel } = await import('../database/models/campaign.model');
    const { default: DiffuseurProfileModel } = await import('../database/models/diffuseur-profile.model');
    const { default: adminRoutes } = await import('../api/routes/admin.routes');
    const { default: internalRoutes } = await import('../api/routes/internal.routes');
    const { submitManualVideo, approveManualVerification } = await import('../services/manual-verification.service');
    const { sendViewTask } = await import('../services/clients/support.service.client');

    await mongoose.connect(process.env.MONGODB_URI!);
    await mongoose.connection.dropDatabase();
    await ManualVerificationModel.syncIndexes();

    const app = express();
    app.use(express.json());
    app.use('/api/advertising/admin', adminRoutes);
    app.use('/api/advertising/internal', internalRoutes);
    app.use((err: any, _req: any, res: any, _next: any) => res.status(err.statusCode || 500).json({ message: err.message }));
    const server = app.listen(0);
    const port = (server.address() as AddressInfo).port;

    const call = (method: string, path: string, headers: Record<string, string>, body?: unknown) => new Promise<Res>((resolve, reject) => {
        const payload = body === undefined ? undefined : JSON.stringify(body);
        const req = http.request({ port, path, method, headers: { ...headers, ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(payload)) } : {}) } }, r => {
            let data = '';
            r.on('data', c => { data += c; });
            r.on('end', () => resolve({ status: r.statusCode || 0, body: data ? JSON.parse(data) : null }));
        });
        req.on('error', reject);
        if (payload) req.write(payload);
        req.end();
    });
    const svc = { Authorization: `Bearer ${process.env.SERVICE_SECRET}`, 'x-service-name': 'support-service', 'x-request-id': 'req-check-1', 'x-support-actor': 'agent-1|verifier' };
    const adminAs = (role: string, userId = new Types.ObjectId().toString()) => ({ Authorization: `Bearer ${jwt.sign({ userId, id: userId, role }, process.env.JWT_SECRET!)}` });

    let n = 0;
    const campaign = await CampaignModel.collection.insertOne({ title: 'Campagne Check', targetUniqueViews: 1000, isTestCampaign: false, uniqueViewsDelivered: 0, repeatViewsDelivered: 0 });
    const campaignId = campaign.insertedId;

    const participation = async (diffuseurUserId = new Types.ObjectId()) => CampaignParticipationModel.create({
        campaignId,
        diffuseurUserId,
        diffuseurProfileId: new Types.ObjectId(),
        status: ParticipationStatus.IN_PROGRESS,
        trackingCode: `chk${Date.now()}${n++}`,
        offeredAt: new Date(), acceptedAt: new Date(), startedAt: new Date(),
        day1Deadline: new Date(Date.now() + 86_400_000),
        completionDeadline: new Date(Date.now() + 3 * 86_400_000),
        days: [
            { day: 1, status: DayStatus.PENDING, viewCount: 0, deliveredCount: 0, ratePerView: 1, earnedAmount: 0 },
            { day: 2, status: DayStatus.PENDING, viewCount: 0, deliveredCount: 0, ratePerView: 0.5, earnedAmount: 0 },
        ],
    });
    const pendingProof = async (p?: any) => {
        const part = p ?? await participation();
        return ManualVerificationModel.create({
            participationId: part._id, campaignId, diffuseurUserId: part.diffuseurUserId, day: 1,
            code: String(100000 + n++), codeIssuedAt: new Date(), expiresAt: new Date(Date.now() + 900_000),
            status: ManualVerificationStatus.PENDING_REVIEW, videoFileId: `proof-${n}.mp4`, uploadedAt: new Date(Date.now() - n * 1000),
        });
    };

    // ── 1. Five concurrent SBC Support decisions → exactly one ──────────────
    {
        const mv = await pendingProof();
        const results = await Promise.all([0, 1, 2, 3, 4].map(i => call('POST', `/api/advertising/internal/manual-verifications/${mv._id}/decision`, svc, {
            decision: 'approve', observedViews: 100 + i, actor: { agentId: `agent-${i}`, name: `Agent ${i}`, role: 'verifier' },
        })));
        const ok = results.filter(r => r.status === 200);
        const conflicts = results.filter(r => r.status === 409 && r.body?.code === 'ALREADY_DECIDED');
        check('decision ×5 concurrently: exactly one success', ok.length === 1, results.map(r => r.status).join(','));
        check('…the four others are 409 ALREADY_DECIDED', conflicts.length === 4);
        const after = await ManualVerificationModel.findById(mv._id).lean();
        const winner = ok[0]?.body?.data;
        check('the proof is approved and records the winning agent', after?.status === 'approved' && after?.decidedBy?.source === 'support'
            && after?.observedViewCount === winner?.viewCount && /^agent-\d$/.test(String(after?.decidedBy?.id)), JSON.stringify(after?.decidedBy));
        check('…with exactly one decision in its history', (after?.history ?? []).filter(e => e.action === 'approved').length === 1);
        const part = await CampaignParticipationModel.findById(mv.participationId).lean();
        const day1 = part?.days.find(d => d.day === 1);
        check('the day is credited once, with the winner\'s count', day1?.status === DayStatus.VERIFIED && day1?.viewCount === winner?.viewCount && part?.totalViews === winner?.viewCount, `${day1?.viewCount} / ${part?.totalViews}`);
        check('one notification only', sentNotifications.filter(s => s === `approved:${mv.diffuseurUserId}`).length === 1);
    }

    // ── 2. Admin and support racing on the same proof ───────────────────────
    {
        process.env.VIDEO_VERIFICATION_ADMIN_READONLY = 'false';
        const mv = await pendingProof();
        const results = await Promise.all([
            call('POST', `/api/advertising/admin/manual-verifications/${mv._id}/approve`, adminAs('moderator'), { observedViewCount: 50 }),
            call('POST', `/api/advertising/admin/manual-verifications/${mv._id}/reject`, adminAs('admin'), { reason: 'Code illisible' }),
            ...[0, 1, 2].map(i => call('POST', `/api/advertising/internal/manual-verifications/${mv._id}/decision`, svc, {
                decision: 'reject', reason: 'Vues invisibles', actor: { agentId: `a${i}`, name: 'X', role: 'verifier' },
            })),
        ]);
        check('admin + support racing (×5): exactly one success, others 409', results.filter(r => r.status === 200).length === 1
            && results.filter(r => r.status === 409).length === 4, results.map(r => r.status).join(','));
        delete process.env.VIDEO_VERIFICATION_ADMIN_READONLY;
    }

    // ── 3. Admin panel read-only by default ─────────────────────────────────
    {
        const mv = await pendingProof();
        for (const role of ['staff', 'moderator', 'withdrawal_admin']) {
            const r = await call('POST', `/api/advertising/admin/manual-verifications/${mv._id}/approve`, adminAs(role), { observedViewCount: 10 });
            check(`read-only: ${role} approve → 403 ADMIN_READONLY`, r.status === 403 && r.body?.code === 'ADMIN_READONLY', `${r.status}`);
        }
        const rj = await call('POST', `/api/advertising/admin/manual-verifications/${mv._id}/reject`, adminAs('staff'), { reason: 'x', ban: true });
        check('read-only: staff reject → 403', rj.status === 403);
        check('…and the proof is untouched', (await ManualVerificationModel.findById(mv._id).lean())?.status === 'pending_review');

        const list = await call('GET', '/api/advertising/admin/manual-verifications', adminAs('moderator'));
        check('the admin list still works for a reviewer and says read-only', list.status === 200 && list.body?.adminDecisions?.readOnly === true && list.body?.adminDecisions?.allowed === false);

        const superAdminId = new Types.ObjectId().toString();
        const ok = await call('POST', `/api/advertising/admin/manual-verifications/${mv._id}/approve`, adminAs('admin', superAdminId), { observedViewCount: 12 });
        const after = await ManualVerificationModel.findById(mv._id).lean();
        check('read-only: the super admin (role admin) may still decide', ok.status === 200 && after?.status === 'approved', `${ok.status}`);
        check('…recorded as an override, with reviewedBy', after?.decidedBy?.override === true && after?.decidedBy?.source === 'admin' && String(after?.reviewedBy) === superAdminId);

        process.env.VIDEO_VERIFICATION_ADMIN_READONLY = 'false';
        const mv2 = await pendingProof();
        const mod = await call('POST', `/api/advertising/admin/manual-verifications/${mv2._id}/approve`, adminAs('moderator'), { observedViewCount: 7 });
        check('with VIDEO_VERIFICATION_ADMIN_READONLY=false, a moderator decides as before', mod.status === 200, `${mod.status}`);
        const again = await call('POST', `/api/advertising/admin/manual-verifications/${mv2._id}/approve`, adminAs('moderator'), { observedViewCount: 7 });
        check('…and a second approval is 409 ALREADY_DECIDED (was a second credit)', again.status === 409 && again.body?.code === 'ALREADY_DECIDED');
        delete process.env.VIDEO_VERIFICATION_ADMIN_READONLY;
    }

    // ── 4. Ban honoured only for supervisor / support admin ─────────────────
    {
        const userA = new Types.ObjectId();
        await DiffuseurProfileModel.collection.insertOne({ userId: userA, isActive: true });
        const mvA = await pendingProof(await participation(userA));
        const r = await call('POST', `/api/advertising/internal/manual-verifications/${mvA._id}/decision`, svc, {
            decision: 'reject', reason: 'Vidéo générée', ban: true, actor: { agentId: 'v1', name: 'Vérif', role: 'verifier' },
        });
        const profA = await DiffuseurProfileModel.findOne({ userId: userA }).lean();
        check('ban by a verifier: proof rejected, ban ignored', r.status === 200 && r.body?.data?.banned === false && r.body?.data?.banIgnored === true && profA?.isActive === true);

        const userB = new Types.ObjectId();
        await DiffuseurProfileModel.collection.insertOne({ userId: userB, isActive: true });
        const mvB = await pendingProof(await participation(userB));
        const rb = await call('POST', `/api/advertising/internal/manual-verifications/${mvB._id}/decision`, svc, {
            decision: 'reject', reason: 'Vidéo générée', ban: true, actor: { agentId: 'sup1', name: 'Superviseur', role: 'views_supervisor' },
        });
        const profB = await DiffuseurProfileModel.findOne({ userId: userB }).lean();
        check('ban by a views_supervisor: diffuseur banned', rb.status === 200 && rb.body?.data?.banned === true && profB?.isActive === false && profB?.banReason === 'Vidéo générée');

        const bad = await call('POST', `/api/advertising/internal/manual-verifications/${mvB._id}/decision`, svc, { decision: 'approve', observedViews: 3 });
        check('a decision without actor is refused (400)', bad.status === 400 && bad.body?.code === 'ACTOR_REQUIRED');
        const noReason = await call('POST', `/api/advertising/internal/manual-verifications/${(await pendingProof())._id}/decision`, svc, { decision: 'reject', actor: { agentId: 'v', role: 'verifier' } });
        check('a rejection without reason is refused (400)', noReason.status === 400);
        const unauth = await call('POST', `/api/advertising/internal/manual-verifications/${mvB._id}/decision`, { Authorization: 'Bearer wrong' }, { decision: 'approve' });
        check('internal routes refuse a wrong service secret', unauth.status === 401);
    }

    // ── 5. A failed credit releases the claim ───────────────────────────────
    {
        const part = await participation();
        const mv = await pendingProof(part);
        await CampaignParticipationModel.updateOne({ _id: part._id }, { $set: { status: ParticipationStatus.FORFEITED } });
        let err: any = null;
        try { await approveManualVerification(new Types.ObjectId(), String(mv._id), 20); } catch (e) { err = e; }
        const after = await ManualVerificationModel.findById(mv._id).lean();
        check('approval that cannot credit the day fails and puts the proof back in the queue', err?.statusCode === 400 && after?.status === 'pending_review'
            && !after?.decidedBy && (after?.history ?? []).some(e => e.action === 'decision_reverted'));
    }

    // ── 6. Submission → SBC Support, never blocking the diffuseur ───────────
    {
        const awaiting = async () => {
            const part = await participation();
            await ManualVerificationModel.create({
                participationId: part._id, campaignId, diffuseurUserId: part.diffuseurUserId, day: 1,
                code: String(200000 + n++), codeIssuedAt: new Date(), expiresAt: new Date(Date.now() + 900_000),
                status: ManualVerificationStatus.AWAITING_UPLOAD,
            });
            return part;
        };

        // Unset: skipped with a warning; the upload succeeds.
        const p1 = await awaiting();
        check('client: SUPPORT_SERVICE_URL unset → no call, returns false', (await sendViewTask({ sourceId: 'x', submittedAt: new Date().toISOString(), campaignId: 'c', diffuseurUserId: 'd', dayIndex: 1, country: 'CM' })) === false);
        const s1 = await submitManualVideo(p1.diffuseurUserId, String(p1._id), 'video-1.mp4');
        check('upload succeeds with SUPPORT_SERVICE_URL unset', s1.status === 'pending_review');
        await new Promise(r => setTimeout(r, 300)); // its (skipped) view task runs after the answer

        // A stub support-service records what it receives.
        const received: any[] = [];
        const stub = http.createServer((req, res) => {
            let data = '';
            req.on('data', c => { data += c; });
            req.on('end', () => { received.push({ url: req.url, auth: req.headers.authorization, rid: req.headers['x-request-id'], body: JSON.parse(data || '{}') }); res.writeHead(201, { 'Content-Type': 'application/json' }); res.end('{"success":true}'); });
        }).listen(0);
        process.env.SUPPORT_SERVICE_URL = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;
        const p2 = await awaiting();
        const s2 = await submitManualVideo(p2.diffuseurUserId, String(p2._id), 'video-2.mp4');
        const again = await submitManualVideo(p2.diffuseurUserId, String(p2._id), 'video-2.mp4').catch((e: any) => e);
        await new Promise(r => setTimeout(r, 400));
        const task = received[0];
        check('a proof entering pending_review is sent to /api/support/internal/view-tasks', received.length === 1 && task?.url === '/api/support/internal/view-tasks'
            && task?.auth === `Bearer ${process.env.SERVICE_SECRET}` && !!task?.rid, JSON.stringify(received.map(r => r.url)));
        check('…with sourceId, submittedAt, campaignId, diffuseurUserId, dayIndex, country', task?.body?.sourceId === s2.manualVerificationId
            && !!task?.body?.submittedAt && task?.body?.campaignId === String(campaignId) && task?.body?.diffuseurUserId === String(p2.diffuseurUserId)
            && task?.body?.dayIndex === 1 && task?.body?.country === 'CM');
        check('a repeated upload of the same proof answers the same and is not re-sent', again?.status === 'pending_review' && received.length === 1);
        stub.close();

        // Unreachable: the upload still succeeds.
        process.env.SUPPORT_SERVICE_URL = DEAD;
        const p3 = await awaiting();
        const s3 = await submitManualVideo(p3.diffuseurUserId, String(p3._id), 'video-3.mp4').catch((e: any) => e);
        check('upload succeeds when support-service is unreachable', s3?.status === 'pending_review');
        await new Promise(r => setTimeout(r, 300));
        delete process.env.SUPPORT_SERVICE_URL;
    }

    // ── 7. Internal list and detail ─────────────────────────────────────────
    {
        const since = new Date(Date.now() - 60_000).toISOString();
        const list = await call('GET', `/api/advertising/internal/manual-verifications?status=pending_review&updatedSince=${encodeURIComponent(since)}&limit=200`, svc);
        const pendingCount = await ManualVerificationModel.countDocuments({ status: 'pending_review' });
        check('internal list: ids + submittedAt of every pending proof', list.status === 200 && list.body.data.length === pendingCount
            && list.body.data.every((i: any) => i.id && 'submittedAt' in i), `${list.body?.data?.length} / ${pendingCount}`);
        const future = await call('GET', `/api/advertising/internal/manual-verifications?updatedSince=${encodeURIComponent(new Date(Date.now() + 60_000).toISOString())}`, svc);
        check('internal list: updatedSince filters', future.status === 200 && future.body.data.length === 0);
        const bad = await call('GET', '/api/advertising/internal/manual-verifications?status=nope', svc);
        check('internal list: unknown status → 400', bad.status === 400);

        const decided = await ManualVerificationModel.findOne({ status: 'approved', 'decidedBy.source': 'support' }).lean();
        const d = await call('GET', `/api/advertising/internal/manual-verifications/${decided?._id}`, svc);
        check('detail: video URL, day, campaign name/target, diffuseur id/name/country', d.status === 200 && /\/api\/settings\/files\//.test(d.body.data.videoUrl)
            && d.body.data.dayIndex === 1 && d.body.data.campaign.name === 'Campagne Check' && d.body.data.campaign.targetViews === 1000
            && d.body.data.diffuseur.country === 'CM' && d.body.data.diffuseur.name === 'Diffuseur Test');
        check('detail: participation and decision history', d.body.data.participation?.day?.status === 'verified' && d.body.data.decision?.decidedBy?.source === 'support'
            && Array.isArray(d.body.data.history.events) && Array.isArray(d.body.data.history.previousAttempts));
        const missing = await call('GET', `/api/advertising/internal/manual-verifications/${new Types.ObjectId()}`, svc);
        check('detail: unknown id → 404', missing.status === 404);
    }

    // ── 8. Admin list pagination ────────────────────────────────────────────
    {
        const total = await ManualVerificationModel.countDocuments({ status: 'pending_review' });
        const all = await call('GET', '/api/advertising/admin/manual-verifications', adminAs('admin'));
        check('admin list without page/limit: the whole queue, as before (data is the array)', all.status === 200 && Array.isArray(all.body.data) && all.body.data.length === total && all.body.pagination.total === total);
        const p1 = await call('GET', '/api/advertising/admin/manual-verifications?page=1&limit=2', adminAs('admin'));
        const p2 = await call('GET', '/api/advertising/admin/manual-verifications?page=2&limit=2', adminAs('admin'));
        check('admin list page 1 / limit 2', p1.body.data.length === Math.min(2, total) && p1.body.pagination.totalPages === Math.ceil(total / 2) && p1.body.pagination.total === total);
        const ids = new Set([...p1.body.data, ...p2.body.data].map((i: any) => i.manualVerificationId));
        check('admin list pages do not overlap, oldest upload first', ids.size === p1.body.data.length + p2.body.data.length
            && new Date(p1.body.data[0].uploadedAt) <= new Date(p1.body.data[p1.body.data.length - 1].uploadedAt));
        check('super admin sees decisions allowed (override)', all.body.adminDecisions?.readOnly === true && all.body.adminDecisions?.allowed === true);
    }

    server.close();
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed');
    process.exit(failures ? 1 : 0);
};

main().catch(async err => {
    console.error(err);
    process.exit(1);
});
