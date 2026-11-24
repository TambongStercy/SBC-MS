/**
 * SBC Impact Challenge v2, Phase 3 — the live final: jury, juror scoring with
 * the authenticator code, live screen, final public vote, lock, result with
 * the 50/30/20 weights, winner. Real MongoDB; user-service and notifications
 * stubbed. The edition is seeded at the TOP 3 (Phase 2's check covers getting
 * there).
 *
 *   CHECK_MONGO_URI=mongodb://127.0.0.1:27017/sbc_impact3_check \
 *     npx ts-node --transpile-only src/scripts/check-impact-final.ts
 */
process.env.REDIS_KEY_PREFIX = `impact3-check-${Date.now()}:`;
import mongoose, { Types } from 'mongoose';
import * as userClient from '../services/clients/user.service.client';
import * as notificationClient from '../services/clients/notification.service.client';
import { AppError } from '../utils/errors';
import { ImpactCandidate, ImpactEdition, ImpactFinalVote, ImpactJuror, ImpactJuryScore } from '../modules/impact/models';
import { CandidateStatus, CompetitionStage, DEFAULT_SETTINGS, EditionStatus, RoundStatus } from '../modules/impact/types';
import * as final from '../modules/impact/services/final.service';
import * as stages from '../modules/impact/services/stage.service';
import * as votes from '../modules/impact/services/vote.service';
import * as editions from '../modules/impact/services/edition.service';
import * as board from '../modules/impact/services/board.service';

const URI = process.env.CHECK_MONGO_URI || 'mongodb://127.0.0.1:27017/sbc_impact3_check';
let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failures++;
};
const refusal = async (fn: () => Promise<unknown>): Promise<any> => { try { await fn(); return null; } catch (e) { return e; } };
const near = (a: number, b: number) => Math.abs(a - b) < 0.02;

// ---------- stubs ----------
const members = new Map<string, { isMember: boolean; createdAt: Date; noApp?: boolean }>();
(userClient as any).getImpactMembers = async (ids: string[]) => ids.filter((id) => members.has(id)).map((id) => ({
    _id: id, name: `Membre ${id.slice(-3)}`, isMember: members.get(id)!.isMember, unavailable: false, createdAt: members.get(id)!.createdAt.toISOString(),
}));
const codeChecks: string[] = [];
(userClient as any).verifyMemberAuthenticator = async (userId: string, code: string) => {
    codeChecks.push(userId);
    if (members.get(userId)?.noApp) throw new AppError('Configurez d’abord l’application…', 403, true, 'AUTHENTICATOR_REQUIRED');
    if (code !== '123456') throw new AppError('Code incorrect.', 400, true, 'AUTH_CODE_INVALID');
};
const pushes: { kind: string; userId?: string }[] = [];
(notificationClient as any).notifyUser = async (a: any) => { pushes.push({ kind: a.kind, userId: a.userId }); return 1; };

const ADMIN = { role: 'admin' as const, userId: new Types.ObjectId().toString() };
const member = (o: { isMember?: boolean; noApp?: boolean } = {}) => {
    const id = new Types.ObjectId().toString();
    members.set(id, { isMember: o.isMember ?? true, createdAt: new Date('2026-01-01'), noApp: o.noApp });
    return id;
};
const ago = (min: number) => new Date(Date.now() - min * 60_000);
const ahead = (min: number) => new Date(Date.now() + min * 60_000);
const marks = (impact: number, innovation: number, faisabilite: number, potentiel: number, presentation: number) => ({ impact, innovation, faisabilite, potentiel, presentation });

const main = async () => {
    await mongoose.connect(URI);
    await mongoose.connection.dropDatabase();
    await Promise.all([ImpactEdition, ImpactCandidate, ImpactJuror, ImpactJuryScore, ImpactFinalVote].map((m) => m.init()));

    // ---------- Seed: an edition at the TOP 3, finalists A B C (paid 100/50/20), D eliminated ----------
    const e = await ImpactEdition.create({
        name: 'Finale test', slug: 'finale-test', rulesText: 'R'.repeat(300), status: EditionStatus.FINAL, stage: CompetitionStage.TOP3,
        schedule: { qualificationOpensAt: ago(60 * 24 * 40), qualificationClosesAt: ago(60 * 24 * 30) },
        settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)), createdBy: new Types.ObjectId(ADMIN.userId),
    });
    const users = { A: member(), B: member(), C: member(), D: member() };
    const mk = (u: string, name: string, status: CandidateStatus, rank: number, paid: number) => ImpactCandidate.create({
        editionId: e._id, userId: new Types.ObjectId(u), sbcId: name.toLowerCase(), status, rank, seatNumber: rank, publishedAt: new Date(),
        consent: { at: new Date(), version: 'v' }, votes: { free: 0, paid, paidAmount: paid * 200 },
        profile: { name, photoFileId: `p/${name}.jpg`, country: 'Cameroun', city: 'Douala', activity: 'x', category: 'Commerce', projectName: `Projet ${name}`, projectDescription: 'desc', presentation: 'pres', extra: {} },
    });
    const A = await mk(users.A, 'A', CandidateStatus.FINALIST, 1, 100);
    const B = await mk(users.B, 'B', CandidateStatus.FINALIST, 2, 50);
    const C = await mk(users.C, 'C', CandidateStatus.FINALIST, 3, 20);
    const D = await mk(users.D, 'D', CandidateStatus.ELIMINATED, 4, 10);
    await ImpactEdition.updateOne({ _id: e._id }, { $set: { top3: { decidedAt: ago(60), by: new Types.ObjectId(ADMIN.userId), ranking: [
        { candidateId: A._id, rank: 1, paidVotes: 100, finalist: true, name: 'A' },
        { candidateId: B._id, rank: 2, paidVotes: 50, finalist: true, name: 'B' },
        { candidateId: C._id, rank: 3, paidVotes: 20, finalist: true, name: 'C' },
        { candidateId: D._id, rank: 4, paidVotes: 10, finalist: false, name: 'D' },
    ] } } });
    const id = String(e._id);

    // ---------- Jury ----------
    check('a finalist cannot be a juror', (await refusal(() => final.addJuror(ADMIN, id, { userId: users.A })))?.code === 'CONFLICT_OF_INTEREST');
    const [J1, J2, J3, Jnoapp] = [member(), member(), member(), member({ noApp: true })];
    for (const j of [J1, J2, J3, Jnoapp]) await final.addJuror(ADMIN, id, { userId: j });
    check('jurors added and told', (await ImpactJuror.countDocuments({ editionId: e._id })) === 4 && pushes.filter((p) => p.kind === 'impact-jury-invited').length === 4);
    check('the same member twice is refused', (await refusal(() => final.addJuror(ADMIN, id, { userId: J1 })))?.code === 'ALREADY_JUROR');
    check('no scoring before the live', (await refusal(() => final.saveScore(J1, id, String(A._id), { scores: marks(8, 8, 8, 8, 8), authCode: '123456' })))?.code === 'WRONG_STAGE');

    // ---------- Live ----------
    const live = await final.startFinal(ADMIN, id);
    check('the final starts (stage LIVE)', live.stage === CompetitionStage.LIVE && pushes.some((p) => p.kind === 'impact-final-started' && p.userId === users.A));
    check('starting twice is refused', (await refusal(() => final.startFinal(ADMIN, id)))?.code === 'WRONG_STAGE');
    await final.setOnStage(ADMIN, id, { candidateId: String(A._id), phase: 'PRESENTATION' });
    check('only a finalist goes on stage', (await refusal(() => final.setOnStage(ADMIN, id, { candidateId: String(D._id) })))?.code === 'NOT_A_FINALIST');
    const screen: any = await final.liveScreen();
    check('live screen: finalists, on stage, no result, no counts', screen.finalists.length === 3 && screen.onStageCandidateId === String(A._id) && screen.phase === 'PRESENTATION' && screen.result === null && !JSON.stringify(screen).includes('finalVotes'));

    // ---------- Scoring ----------
    check('first score needs the authenticator code', (await refusal(() => final.saveScore(J1, id, String(A._id), { scores: marks(8, 8, 8, 8, 8) })))?.code === 'AUTH_CODE_REQUIRED');
    check('a wrong code is refused', (await refusal(() => final.saveScore(J1, id, String(A._id), { scores: marks(8, 8, 8, 8, 8), authCode: '000000' })))?.code === 'AUTH_CODE_INVALID');
    const noApp = await refusal(() => final.saveScore(Jnoapp, id, String(A._id), { scores: marks(8, 8, 8, 8, 8), authCode: '123456' }));
    check('a juror without the app is told to set it up (jury wording)', noApp?.code === 'AUTHENTICATOR_REQUIRED' && /noter/.test(noApp.message));
    check('a mark above the maximum is refused', (await refusal(() => final.saveScore(J1, id, String(A._id), { scores: marks(11, 8, 8, 8, 8), authCode: '123456' })))?.details?.field === 'scores.impact');
    check('marks go by half points', (await refusal(() => final.saveScore(J1, id, String(A._id), { scores: marks(8.3, 8, 8, 8, 8), authCode: '123456' })))?.code === 'INVALID_SCORE');
    const s1 = await final.saveScore(J1, id, String(A._id), { scores: marks(8, 8, 8, 8, 6), authCode: '123456', comment: 'Très clair' });
    check('score saved, total computed', s1.total === 38);
    const before = codeChecks.length;
    const s1b = await final.saveScore(J1, id, String(A._id), { scores: marks(8, 8, 8, 8, 8) });
    check('within 30 min no new code; the correction keeps the previous version', s1b.total === 40 && s1b.edits === 1 && codeChecks.length === before);
    check('the history holds the first version', (await ImpactJuryScore.findOne({ jurorUserId: new Types.ObjectId(J1), candidateId: A._id }))!.history[0].total === 38);
    check('a non-juror cannot score', (await refusal(() => final.saveScore(member(), id, String(A._id), { scores: marks(8, 8, 8, 8, 8), authCode: '123456' })))?.code === 'NOT_A_JUROR');
    check('an eliminated candidate is not scored', (await refusal(() => final.saveScore(J1, id, String(D._id), { scores: marks(8, 8, 8, 8, 8) })))?.code === 'NOT_A_FINALIST');
    // J1: A 40, B 45, C 30. J2: A 44, B 40. J3 scores C 50 then is removed: must not count.
    await final.saveScore(J1, id, String(B._id), { scores: marks(9, 9, 9, 9, 9) });
    await final.saveScore(J1, id, String(C._id), { scores: marks(6, 6, 6, 6, 6) });
    await final.saveScore(J2, id, String(A._id), { scores: marks(9, 9, 9, 9, 8), authCode: '123456' });
    await final.saveScore(J2, id, String(B._id), { scores: marks(8, 8, 8, 8, 8) });
    await final.saveScore(J3, id, String(C._id), { scores: marks(10, 10, 10, 10, 10), authCode: '123456' });
    await final.removeJuror(ADMIN, id, String((await ImpactJuror.findOne({ userId: new Types.ObjectId(J3) }))!._id), 'Conflit d’intérêt découvert');
    const mine = await final.myJury(J1);
    check('jury space: criteria, finalists and own marks', mine.length === 1 && mine[0].finalists.length === 3 && mine[0].finalists.find((f: any) => f._id === String(A._id))?.myScore?.total === 40 && mine[0].canScore === true);

    // ---------- Final public vote ----------
    await stages.scheduleRound(ADMIN, id, 'FINAL', { opensAt: ago(1), closesAt: ahead(30) });
    await stages.roundTick();
    check('the final vote opens on its date during the live', (await ImpactEdition.findById(e._id))!.rounds.FINAL.status === RoundStatus.OPEN);
    const sig = { ip: '41.1.1.1', ua: 'ua' };
    const V = [member(), member(), member(), member()];
    await votes.castFinalVote(V[0], { candidateId: String(A._id) }, sig);
    await votes.castFinalVote(V[1], { candidateId: String(B._id) }, sig);
    await votes.castFinalVote(V[2], { candidateId: String(B._id) }, sig);
    await votes.castFinalVote(V[3], { candidateId: String(B._id) }, sig);
    check('1 compte = 1 vote public final', (await refusal(() => votes.castFinalVote(V[0], { candidateId: String(B._id) }, sig)))?.code === 'ALREADY_VOTED');
    check('only finalists receive the final vote', (await refusal(() => votes.castFinalVote(member(), { candidateId: String(D._id) }, sig)))?.code === 'CANDIDATE_NOT_VOTABLE');
    check('members only (same rule as week 2)', (await refusal(() => votes.castFinalVote(member({ isMember: false }), { candidateId: String(A._id) }, sig)))?.code === 'MEMBERS_ONLY');
    const mv = await votes.myVotes(V[1]);
    check('my votes: the final vote, named, and no second one', mv.finalVote?.candidateName === 'B' && mv.canFinalVote?.code === 'ALREADY_VOTED');
    check('my votes: a new member may vote in the final', (await votes.myVotes(member())).canFinalVote?.ok === true);

    // ---------- Lock and result ----------
    const early: any = await final.resultPreview(id);
    check('result blocked while the jury is not locked and the vote is open', early.blockers.some((b: any) => b.code === 'JURY_NOT_LOCKED') && early.blockers.some((b: any) => b.code === 'ROUND_OPEN'));
    await ImpactJuryScore.deleteMany({ jurorUserId: new Types.ObjectId(J2) });
    await ImpactJuryScore.deleteMany({ jurorUserId: new Types.ObjectId(J1), candidateId: C._id });
    const missing = await refusal(() => final.lockJury(ADMIN, id));
    check('lock refused while a finalist has no mark (removed juror does not count)', missing?.code === 'MISSING_SCORES' && missing.details.missing.find((m: any) => m.candidateId === String(C._id))?.scoredBy === 0);
    await final.saveScore(J1, id, String(C._id), { scores: marks(6, 6, 6, 6, 6) });
    await final.saveScore(J2, id, String(A._id), { scores: marks(9, 9, 9, 9, 8), authCode: '123456' });
    await final.saveScore(J2, id, String(B._id), { scores: marks(8, 8, 8, 8, 8) });
    const partial = await refusal(() => final.lockJury(ADMIN, id));
    const of = (c: any) => partial?.details?.missing?.find((m: any) => m.candidateId === String(c._id));
    check('lock refused until every active juror has scored every finalist (Rufus)', partial?.code === 'MISSING_SCORES' && of(C)?.scoredBy === 1 && of(C)?.notScoredBy.length === 2 && of(A)?.notScoredBy.length === 1);
    await final.saveScore(J2, id, String(C._id), { scores: marks(6, 6, 6, 6, 6) });
    check('a juror who cannot score still blocks the lock', (await refusal(() => final.lockJury(ADMIN, id)))?.code === 'MISSING_SCORES');
    await final.removeJuror(ADMIN, id, String((await ImpactJuror.findOne({ userId: new Types.ObjectId(Jnoapp) }))!._id), 'Pas d’application d’authentification');
    await final.lockJury(ADMIN, id);
    check('no score after the lock', (await refusal(() => final.saveScore(J1, id, String(A._id), { scores: marks(1, 1, 1, 1, 1) })))?.code === 'JURY_LOCKED');
    check('the jury no longer changes after the lock', (await refusal(() => final.addJuror(ADMIN, id, { userId: member() })))?.code === 'JURY_LOCKED');
    await stages.closeRoundNow(ADMIN, id, 'FINAL', 'Fin du vote public');

    const p: any = await final.resultPreview(id);
    const row = (c: any) => p.rows.find((r: any) => r.candidateId === String(c._id));
    // paid 100/50/20 → 100/50/20; public 1/3/0 → 33.33/100/0; jury avg 42/42.5/30 → 98.82/100/70.59
    check('jury part: average of the active jurors only', row(A).juryAverage === 42 && row(B).juryAverage === 42.5 && row(C).juryAverage === 30 && row(C).jurorsCount === 2);
    check('parts on 100 (the best gets 100)', row(A).components.paidVotes === 100 && near(row(A).components.publicVote, 33.33) && row(B).components.jury === 100 && near(row(C).components.jury, 70.59));
    check('score = 50/30/20 weighted', near(row(A).score, 79.76) && near(row(B).score, 75) && near(row(C).score, 24.12), p.rows.map((r: any) => `${r.name}:${r.score}`).join(' '));
    check('ranked by score', p.rows.map((r: any) => r.name).join() === 'A,B,C' && p.blockers.length === 0);
    check('the formula is given with the result', typeof p.formula === 'string' && p.formula.includes('100'));
    check('publishing a result read before a change is refused', (await refusal(() => final.publishResult(ADMIN, id, { expectedOrder: [String(B._id), String(A._id), String(C._id)] })))?.code === 'STALE');
    const pub = await final.publishResult(ADMIN, id, { expectedOrder: p.rows.map((r: any) => r.candidateId) });
    check('result published: edition finished, winner set', pub.status === EditionStatus.FINISHED && pub.stage === CompetitionStage.RESULT && String(pub.result!.winnerCandidateId) === String(A._id));
    check('winner and finalists', (await ImpactCandidate.findById(A._id))!.status === CandidateStatus.WINNER && (await ImpactCandidate.findById(B._id))!.status === CandidateStatus.FINALIST && (await ImpactCandidate.findById(B._id))!.rank === 2);
    check('winner and finalists are told', pushes.some((x) => x.kind === 'impact-winner' && x.userId === users.A) && pushes.some((x) => x.kind === 'impact-final-result' && x.userId === users.B));
    check('the result is published once', (await refusal(() => final.publishResult(ADMIN, id, { expectedOrder: p.rows.map((r: any) => r.candidateId) })))?.code === 'ALREADY_PUBLISHED');
    final.invalidateFinal();
    const after: any = await final.liveScreen();
    check('live screen shows the result with its three parts', after.result?.winnerCandidateId === String(A._id) && after.result.rows[0].components.paidVotes === 100);
    editions.invalidateCurrent();
    check('the finished edition stays current (result visible)', String((await editions.currentEdition())?._id) === id);
    board.invalidateBoard();
    const b: any = await board.currentBoard();
    check('the board shows the final order', b.candidates.slice(0, 3).map((c: any) => c.profile.name).join() === 'A,B,C' && b.candidates[0].statusLabel === 'Gagnant');

    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
    process.exit(failures ? 1 : 0);
};

main().catch(async (err) => { console.error(err); await mongoose.disconnect().catch(() => undefined); process.exit(1); });
