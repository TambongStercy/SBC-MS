/**
 * SBC Impact Challenge v2, Phase 5 — « SBC Impact » showcase: pages created at
 * the result, 12 months minimum then the archive, admin links (podcast,
 * YouTube, shop), hide, finalist news reviewed before publication.
 * Real MongoDB; notifications stubbed.
 *
 *   CHECK_MONGO_URI=mongodb://127.0.0.1:27017/sbc_impact5_check \
 *     npx ts-node --transpile-only src/scripts/check-impact-showcase.ts
 */
process.env.REDIS_KEY_PREFIX = `impact5-check-${Date.now()}:`;
import mongoose, { Types } from 'mongoose';
import * as notificationClient from '../services/clients/notification.service.client';
import { ImpactCandidate, ImpactEdition, ImpactShowcase, ImpactShowcaseUpdate, ImpactSubmission } from '../modules/impact/models';
import { CandidateStatus, CompetitionStage, DEFAULT_SETTINGS, EditionStatus, SubmissionKind, SubmissionStatus } from '../modules/impact/types';
import * as showcase from '../modules/impact/services/showcase.service';

const URI = process.env.CHECK_MONGO_URI || 'mongodb://127.0.0.1:27017/sbc_impact5_check';
let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failures++;
};
const refusal = async (fn: () => Promise<unknown>): Promise<any> => { try { await fn(); return null; } catch (e) { return e; } };
const pushes: { kind: string; userId?: string }[] = [];
(notificationClient as any).notifyUser = async (a: any) => { pushes.push({ kind: a.kind, userId: a.userId }); return 1; };
const ADMIN = { role: 'admin' as const, userId: new Types.ObjectId().toString() };

const seedEdition = async (name: string, publishedAt: Date) => {
    const e = await ImpactEdition.create({
        name, slug: `${name}-${Date.now()}`.toLowerCase().replace(/\s+/g, '-'), rulesText: 'R'.repeat(300),
        status: EditionStatus.FINISHED, stage: CompetitionStage.RESULT,
        schedule: { qualificationOpensAt: new Date('2025-01-01'), qualificationClosesAt: new Date('2025-02-01') },
        settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)), createdBy: new Types.ObjectId(ADMIN.userId),
    });
    const users = [new Types.ObjectId(), new Types.ObjectId(), new Types.ObjectId()];
    const cands = [];
    for (let i = 0; i < 3; i++) {
        cands.push(await ImpactCandidate.create({
            editionId: e._id, userId: users[i], sbcId: `c${i}`, status: i === 0 ? CandidateStatus.WINNER : CandidateStatus.FINALIST, rank: i + 1, seatNumber: i + 1,
            consent: { at: new Date(), version: 'v' },
            profile: { name: `Finaliste ${i + 1}`, photoFileId: `p/${i}.jpg`, country: 'Cameroun', city: 'Douala', activity: 'Agro', category: 'Commerce', projectName: `Projet ${i + 1}`, projectDescription: 'desc', presentation: 'pres', link: i === 0 ? 'https://shop.example.com/a' : undefined, extra: {} },
        }));
    }
    await ImpactSubmission.create({ editionId: e._id, candidateId: cands[0]._id, userId: users[0], kind: SubmissionKind.VIDEO, version: 1, current: true, status: SubmissionStatus.ACCEPTED, video: { videoFileId: 'videos/a.mp4' } });
    await ImpactEdition.updateOne({ _id: e._id }, { $set: { result: {
        publishedAt, by: new Types.ObjectId(ADMIN.userId), weights: { paidVotes: 50, publicVote: 30, jury: 20 },
        rows: cands.map((c, i) => ({ candidateId: c._id, name: c.profile.name, projectName: c.profile.projectName, paidVotes: 10, finalVotes: 1, juryAverage: 30, juryMax: 50, jurorsCount: 2, components: { paidVotes: 100, publicVote: 100, jury: 100 }, score: 90 - i * 10, rank: i + 1 })),
        winnerCandidateId: cands[0]._id,
    } } });
    return { e, cands, users };
};

const main = async () => {
    await mongoose.connect(URI);
    await mongoose.connection.dropDatabase();
    await Promise.all([ImpactEdition, ImpactCandidate, ImpactShowcase, ImpactShowcaseUpdate, ImpactSubmission].map((m) => m.init()));

    // ---------- Pages from the result ----------
    const now = new Date();
    const { e, cands, users } = await seedEdition('Édition récente', now);
    const created = await showcase.createForEdition(e._id, ADMIN);
    check('one page per finalist', created === 3);
    check('creating again changes nothing (idempotent)', (await showcase.createForEdition(e._id, ADMIN)) === 0);
    const page = (await ImpactShowcase.findOne({ candidateId: cands[0]._id }))!;
    check('page: profile snapshot, result, video, shop link from the profile',
        page.profile.name === 'Finaliste 1' && page.result.winner === true && page.result.rank === 1 && page.videoFileId === 'videos/a.mp4' && page.shopUrl === 'https://shop.example.com/a');
    const months = (page.visibleUntil.getFullYear() - page.visibleFrom.getFullYear()) * 12 + page.visibleUntil.getMonth() - page.visibleFrom.getMonth();
    check('visible 12 months', months === 12);
    check('finalists told their page is live', pushes.filter((p) => p.kind === 'impact-showcase-live').length === 3);

    // An older edition: 13 months ago → archived.
    const old = await seedEdition('Ancienne', new Date(Date.now() - 400 * 86_400_000));
    await showcase.createForEdition(old.e._id, ADMIN);
    const pub = await showcase.publicList();
    check('public: 3 on show, 3 archived (past 12 months, never deleted)', pub.active.length === 3 && pub.archived.length === 3);
    check('the winner comes first', pub.active[0].result.winner === true);
    check('the public view carries no member id', !JSON.stringify(pub).includes(String(users[0])));

    // ---------- Admin links, minimum duration, hide ----------
    const pid = String(page._id);
    check('YouTube link must be YouTube', (await refusal(() => showcase.adminEdit(ADMIN, pid, { youtubeUrl: 'https://vimeo.com/1' })))?.code === 'INVALID_URL');
    check('links must be https', (await refusal(() => showcase.adminEdit(ADMIN, pid, { podcast: { url: 'http://pod.example.com/1' } })))?.code === 'INVALID_URL');
    const ed = await showcase.adminEdit(ADMIN, pid, { youtubeUrl: 'https://www.youtube.com/watch?v=abc', podcast: { url: 'https://open.spotify.com/episode/xyz', title: 'Épisode 1', platform: 'Spotify' } });
    check('podcast and YouTube set', ed.youtubeUrl!.includes('youtube.com') && ed.podcast?.title === 'Épisode 1');
    check('the end date cannot go under 12 months', (await refusal(() => showcase.adminEdit(ADMIN, pid, { visibleUntil: new Date(Date.now() + 30 * 86_400_000).toISOString() })))?.code === 'TOO_EARLY');
    const longer = new Date(page.visibleUntil.getTime() + 180 * 86_400_000);
    check('the end date can be extended', (await showcase.adminEdit(ADMIN, pid, { visibleUntil: longer.toISOString() })).visibleUntil.getTime() === longer.getTime());
    const thirdId = String((await ImpactShowcase.findOne({ candidateId: cands[2]._id }))!._id);
    check('hiding needs a reason', (await refusal(() => showcase.adminEdit(ADMIN, thirdId, { hidden: true })))?.code === 'REASON_REQUIRED');
    await showcase.adminEdit(ADMIN, thirdId, { hidden: true, hiddenReason: 'Demande du finaliste' });
    check('a hidden page appears nowhere publicly', (await showcase.publicList()).active.length === 2 && (await refusal(() => showcase.publicOne(thirdId)))?.statusCode === 404);

    // ---------- News ----------
    const adminNews = await showcase.adminPostUpdate(ADMIN, pid, { kind: 'ACHIEVEMENT', title: 'Premier contrat', body: 'Le projet a signé son premier contrat avec un supermarché de Douala.' });
    check('admin news published at once', adminNews.publishedAt !== null);
    const proposal = await showcase.proposeUpdate(String(users[0]), pid, { kind: 'PRODUCT', title: 'Nouveau produit', body: 'Nous lançons une farine de manioc enrichie, disponible dès ce mois.', link: 'https://shop.example.com/farine' });
    check('finalist news waits for validation', (proposal as any).status === 'PENDING' && (await showcase.publicOne(pid)).updates.length === 1);
    check('another member cannot post on this page', (await refusal(() => showcase.proposeUpdate(String(new Types.ObjectId()), pid, { title: 'xxx', body: 'y'.repeat(30) })))?.statusCode === 404);
    check('news text has bounds', (await refusal(() => showcase.proposeUpdate(String(users[0]), pid, { title: 'ok titre', body: 'court' })))?.details?.field === 'body');
    check('rejecting needs a reason', (await refusal(() => showcase.reviewUpdate(ADMIN, proposal._id, { decision: 'reject', reason: 'non' })))?.code === 'REASON_REQUIRED');
    await showcase.reviewUpdate(ADMIN, proposal._id, { decision: 'approve' });
    check('approved news is public, newest first', (await showcase.publicOne(pid)).updates[0].title === 'Nouveau produit');
    check('the finalist is told', pushes.some((p) => p.kind === 'impact-showcase-update-published' && p.userId === String(users[0])));
    check('a review happens once', (await refusal(() => showcase.reviewUpdate(ADMIN, proposal._id, { decision: 'approve' })))?.code === 'ALREADY_REVIEWED');
    await showcase.reviewUpdate(ADMIN, proposal._id, { decision: 'remove', reason: 'Lien cassé' });
    check('a published news can be removed', (await showcase.publicOne(pid)).updates.length === 1);
    const mine = await showcase.mine(String(users[0]));
    check('the finalist sees their pages and their news with its state', mine.length === 1 && mine[0].updates.length === 1);
    const oldPageId = String((await ImpactShowcase.findOne({ candidateId: old.cands[0]._id }))!._id);
    check('no news on an archived page', (await refusal(() => showcase.proposeUpdate(String(old.users[0]), oldPageId, { title: 'Nouvelles', body: 'z'.repeat(30) })))?.code === 'ARCHIVED');
    const queue = await showcase.pendingUpdates();
    check('admin queue: pending finalist news only', queue.length === 0);

    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
    process.exit(failures ? 1 : 0);
};

main().catch(async (err) => { console.error(err); await mongoose.disconnect().catch(() => undefined); process.exit(1); });
