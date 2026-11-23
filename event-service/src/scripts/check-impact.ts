/**
 * SBC Impact Challenge v2, Phase 1 — end-to-end service checks against a real
 * MongoDB (user-service and notifications stubbed): edition rules and locks,
 * applying, the invitation counter, seats in order of arrival, the waiting
 * list, closing, promotions, suspensions, reviews.
 *
 *   CHECK_MONGO_URI=mongodb://127.0.0.1:27017/sbc_impact_check \
 *     npx ts-node --transpile-only src/scripts/check-impact.ts
 * Uses its own database (dropped at the end).
 */
import mongoose, { Types } from 'mongoose';
import * as userClient from '../services/clients/user.service.client';
import * as notificationClient from '../services/clients/notification.service.client';
import { ImpactAudit, ImpactCandidate, ImpactEdition } from '../modules/impact/models';
import { CandidateStatus, EditionStatus, ProfileReview } from '../modules/impact/types';
import * as editions from '../modules/impact/services/edition.service';
import * as candidates from '../modules/impact/services/candidate.service';
import { assignSeats, qualificationTick, seatHolders } from '../modules/impact/services/qualification.service';

const URI = process.env.CHECK_MONGO_URI || 'mongodb://127.0.0.1:27017/sbc_impact_check';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failures++;
};
const refusal = async (fn: () => Promise<unknown>): Promise<any> => { try { await fn(); return null; } catch (e) { return e; } };

// ---- stubs ----
const members = new Map<string, { isMember: boolean; unavailable?: boolean }>();
const stats = new Map<string, { valid: number; pending: number; reachedAt: string | null; changedAt: number }>();
const invitationCalls: { changedSince?: Date; ids: string[] }[] = [];
(userClient as any).getImpactMembers = async (ids: string[]) => ids.filter((id) => members.has(id)).map((id) => ({
    _id: id, name: 'X', referralCode: `code${id.slice(-4)}`, isMember: members.get(id)!.isMember, unavailable: Boolean(members.get(id)!.unavailable),
}));
(userClient as any).getImpactInvitations = async (a: { referrerIds: string[]; changedSince?: Date }) => {
    invitationCalls.push({ changedSince: a.changedSince, ids: a.referrerIds });
    return a.referrerIds
        .filter((id) => stats.has(id) && (!a.changedSince || stats.get(id)!.changedAt >= a.changedSince.getTime()))
        .map((id) => ({ referrerId: id, ...stats.get(id)! }));
};
const sent: { kind: string; userId?: string }[] = [];
(notificationClient as any).notifyUser = async (a: any) => { sent.push({ kind: a.kind, userId: a.userId }); return 1; };

const ADMIN = { role: 'admin' as const, userId: new Types.ObjectId().toString() };
const RULES = 'Règlement du SBC Impact Challenge. '.repeat(10);
const hours = (h: number) => new Date(Date.now() + h * 3600_000);

const profile = (n: string) => ({
    consent: true,
    name: `Candidat ${n}`,
    photoFileId: `avatars/${n}.jpg`,
    country: 'Cameroun', city: 'Douala',
    activity: 'Vente de produits locaux',
    category: 'Commerce',
    projectName: `Projet ${n}`,
    projectDescription: 'Un projet qui transforme les produits agricoles locaux.',
    presentation: 'Nous achetons aux producteurs, transformons et vendons en ligne et en boutique, avec un impact direct sur les revenus.',
});

const newMember = () => {
    const id = new Types.ObjectId().toString();
    members.set(id, { isMember: true });
    return id;
};
const reach = (id: string, valid: number, reachedAt: Date | null) =>
    stats.set(id, { valid, pending: 0, reachedAt: reachedAt?.toISOString() ?? null, changedAt: Date.now() });
const cand = (userId: string) => ImpactCandidate.findOne({ userId: new Types.ObjectId(userId) });
const kinds = (userId: string) => sent.filter((s) => s.userId === userId).map((s) => s.kind);

const main = async () => {
    await mongoose.connect(URI);
    await mongoose.connection.dropDatabase();
    await Promise.all([ImpactEdition.init(), ImpactCandidate.init(), ImpactAudit.init()]);

    // ---------- Edition: creation, rules, opening, locks ----------
    const badSchedule = await refusal(() => editions.createEdition(ADMIN, { name: 'Édition test', schedule: { qualificationOpensAt: hours(2), qualificationClosesAt: hours(1) } }));
    check('schedule: qualification must end after it opens', badSchedule?.code === 'INVALID_SCHEDULE');
    const badWeights = await refusal(() => editions.createEdition(ADMIN, {
        name: 'Édition test', schedule: { qualificationOpensAt: hours(-1), qualificationClosesAt: hours(24) },
        settings: { weights: { paidVotes: 50, publicVote: 30, jury: 30 } },
    }));
    check('settings: final weights must total 100 %', badWeights?.code === 'INVALID_SETTINGS');

    const e = await editions.createEdition(ADMIN, {
        name: 'SBC Impact Challenge — Édition test',
        schedule: { qualificationOpensAt: hours(-1), qualificationClosesAt: hours(24) },
        settings: { maxCandidates: 3, invitationsRequired: 2, waitlistSize: 1, finalistsCount: 2 },
    });
    check('defaults: Rufus’s 50/30/20 weights', JSON.stringify(e.settings.weights) === JSON.stringify({ paidVotes: 50, publicVote: 30, jury: 20 }));
    check('defaults: ticket tiers 1–10 / 11–50 / 51+', JSON.stringify(e.settings.ticketTiers) === JSON.stringify([{ upTo: 10, weight: 1 }, { upTo: 50, weight: 0.5 }, { upTo: null, weight: 0.25 }]));

    check('opening refused without written rules', (await refusal(() => editions.openQualification(ADMIN, String(e._id))))?.code === 'RULES_MISSING');
    await editions.updateEdition(ADMIN, String(e._id), { rulesText: RULES });
    const opened = await editions.openQualification(ADMIN, String(e._id));
    check('qualification opens', opened.status === EditionStatus.QUALIFICATION);

    const other = await editions.createEdition(ADMIN, { name: 'Autre édition', rulesText: RULES, schedule: { qualificationOpensAt: hours(-1), qualificationClosesAt: hours(24) } });
    check('only one edition runs at a time', (await refusal(() => editions.openQualification(ADMIN, String(other._id))))?.code === 'ANOTHER_EDITION_RUNNING');

    const lockSeats = await refusal(() => editions.updateEdition(ADMIN, String(e._id), { settings: { maxCandidates: 30 } }));
    check('seats are locked once qualification is open', lockSeats?.code === 'RULES_LOCKED' && lockSeats.details.fields.includes('settings.maxCandidates'));
    check('the published rules are locked', (await refusal(() => editions.updateEdition(ADMIN, String(e._id), { rulesText: 'autre' })))?.code === 'RULES_LOCKED');
    const prizes = [{ key: 'cash', label: '500 000 F', category: 'cash' }, { key: 'pc', label: 'Ordinateur portable', category: 'ordinateur' }];
    const withPrizes = await editions.updateEdition(ADMIN, String(e._id), { settings: { prizes } });
    check('prizes stay editable (Rufus)', withPrizes.settings.prizes[0].label === '500 000 F');
    check('vote price still editable before the competition', (await editions.updateEdition(ADMIN, String(e._id), { settings: { votePrice: 250 } })).settings.votePrice === 250);

    // ---------- Applying ----------
    const outsider = new Types.ObjectId().toString();
    members.set(outsider, { isMember: false });
    check('a member without a pack cannot apply', (await refusal(() => candidates.apply(outsider, profile('o'))))?.code === 'NOT_A_MEMBER');
    const [A, B, C, D, E, F] = Array.from({ length: 6 }, newMember);
    check('consent is required', (await refusal(() => candidates.apply(A, { ...profile('a'), consent: false })))?.code === 'CONSENT_REQUIRED');
    check('photo is required', (await refusal(() => candidates.apply(A, { ...profile('a'), photoFileId: 'https://evil.example/x.jpg' })))?.code === 'INVALID_PROFILE');
    check('category must be one of the list', (await refusal(() => candidates.apply(A, { ...profile('a'), category: 'Inventée' })))?.code === 'INVALID_PROFILE');
    check('link must be a web address', (await refusal(() => candidates.apply(A, { ...profile('a'), link: 'javascript:alert(1)' })))?.code === 'INVALID_PROFILE');

    reach(A, 1, null); // already one invitation before applying
    const ca = await candidates.apply(A, profile('a'));
    check('application starts in qualification', ca.status === CandidateStatus.QUALIFYING && ca.review.status === ProfileReview.PENDING);
    check('the counter is filled at once', ca.invitations.valid === 1 && ca.invitations.required === 2);
    check('SBC id is the referral code', ca.sbcId === `code${A.slice(-4)}`);
    check('one candidacy per member', (await refusal(() => candidates.apply(A, profile('a'))))?.code === 'ALREADY_CANDIDATE');
    for (const [id, n] of [[B, 'b'], [C, 'c'], [D, 'd'], [E, 'e'], [F, 'f']] as const) await candidates.apply(id, profile(n));

    // ---------- Seats in order of arrival ----------
    const t = (m: number) => new Date(Date.now() - 50 * 60_000 + m * 60_000);
    // B reached first, then A, then D, C, E; F never reaches.
    reach(B, 2, t(1)); reach(A, 2, t(2)); reach(D, 3, t(3)); reach(C, 2, t(4)); reach(E, 2, t(5)); reach(F, 1, null);
    await qualificationTick();
    const [cA, cB, cC, cD, cE, cF] = await Promise.all([A, B, C, D, E, F].map(cand));
    check('seat 1 goes to the first to reach the count', cB?.status === CandidateStatus.OFFICIAL && cB.seatNumber === 1);
    check('seats follow payment order, not sign-up order', cA?.seatNumber === 2 && cD?.seatNumber === 3, `A=${cA?.seatNumber} D=${cD?.seatNumber}`);
    check('next one goes to the waiting list', cC?.status === CandidateStatus.WAITLIST && cC.waitlistRank === 1);
    check('beyond seats + waiting list: not selected', cE?.status === CandidateStatus.NOT_SELECTED);
    const closed = await ImpactEdition.findById(e._id);
    check('seats and waiting list full: qualification closes', closed?.status === EditionStatus.QUALIFICATION_CLOSED && closed.registrationClosedReason === 'full');
    check('those who never reached the count are told it is over', cF?.status === CandidateStatus.NOT_SELECTED && kinds(F).includes('impact-not-selected'));
    check('« participation débloquée » sent to seat holders', kinds(B).includes('impact-unlocked') && kinds(A).includes('impact-unlocked'));
    check('waiting-list notice sent', kinds(C).includes('impact-waitlisted'));
    check('a newcomer cannot apply any more', (await refusal(() => candidates.apply(newMember(), profile('g'))))?.code === 'REGISTRATION_CLOSED');
    check('seat count is 3/3', (await seatHolders(e._id)) === 3);

    // ---------- A seat frees up: the waiting list moves up ----------
    check('disqualifying needs a reason', (await refusal(() => candidates.disqualify(ADMIN, String(cA!._id), { reason: 'non' })))?.code === 'REASON_REQUIRED');
    await candidates.disqualify(ADMIN, String(cA!._id), { reason: 'Profil frauduleux constaté' });
    await assignSeats(e._id);
    const cC2 = await cand(C);
    check('first of the waiting list gets the freed seat', cC2?.status === CandidateStatus.OFFICIAL && cC2.seatNumber === 4 && kinds(C).includes('impact-promoted'));
    check('seat numbers are never reused', (await ImpactCandidate.countDocuments({ editionId: e._id, seatNumber: 2 })) === 1);

    // ---------- Suspension keeps the seat; reinstating gives it back ----------
    await candidates.suspend(ADMIN, String(cB!._id), { reason: 'Vérification d’identité en cours' });
    check('a suspended candidate keeps the seat', (await seatHolders(e._id)) === 3 && (await cand(B))?.status === CandidateStatus.SUSPENDED);
    await assignSeats(e._id);
    check('nobody is promoted over a suspended seat', (await ImpactCandidate.countDocuments({ editionId: e._id, status: CandidateStatus.OFFICIAL })) === 2);
    await candidates.reinstate(ADMIN, String(cB!._id), { reason: 'Identité vérifiée' });
    check('reinstating returns to the previous status', (await cand(B))?.status === CandidateStatus.OFFICIAL);

    // ---------- Profile review ----------
    const fresh = (await cand(D))!;
    check('asking for changes needs a reason', (await refusal(() => candidates.reviewProfile(ADMIN, String(fresh._id), { decision: 'changes', reason: 'court' })))?.code === 'REASON_REQUIRED');
    const stale = await refusal(() => candidates.reviewProfile(ADMIN, String(fresh._id), { decision: 'approve', profileUpdatedAt: new Date(0).toISOString() }));
    check('approving a profile changed since it was read is refused', stale?.code === 'STALE');
    const approved = await candidates.reviewProfile(ADMIN, String(fresh._id), { decision: 'approve', profileUpdatedAt: fresh.profileUpdatedAt.toISOString() });
    check('profile approved, « candidature validée » sent', approved.review.status === ProfileReview.APPROVED && kinds(D).includes('impact-profile-approved'));
    // The counter job writing invitations must not make the review stale.
    await ImpactCandidate.updateOne({ _id: fresh._id }, { $set: { 'invitations.checkedAt': new Date() } });
    const again = await refusal(() => candidates.reviewProfile(ADMIN, String(fresh._id), { decision: 'approve', profileUpdatedAt: fresh.profileUpdatedAt.toISOString() }));
    check('a recount does not make the review stale', again === null);
    const edited = await candidates.updateMine(D, { projectName: 'Projet D, nouvelle version' });
    check('the member’s edit sends the profile back to review', edited.review.status === ProfileReview.PENDING && edited.profile.projectName === 'Projet D, nouvelle version');
    check('the edit keeps the other fields', edited.profile.city === 'Douala');

    // ---------- Withdrawal ----------
    await candidates.withdrawMine(D);
    check('a candidate can withdraw before the competition', (await cand(D))?.status === CandidateStatus.WITHDRAWN);
    check('the withdrawn seat is freed', (await seatHolders(e._id)) === 2);

    // ---------- Member space ----------
    const space = await candidates.mySpace(B);
    check('member space shows the edition and the candidacy', space.edition?.seats.max === 3 && space.candidacy?.seatNumber === 1);
    const outsiderSpace = await candidates.mySpace(new Types.ObjectId().toString());
    check('a non-candidate sees why they cannot apply', outsiderSpace.canApply === false && outsiderSpace.blocker?.code === 'REGISTRATION_CLOSED');
    editions.invalidateCurrent();
    const pub = await editions.currentPublic();
    check('public summary: seats and rules', pub?.seats.taken === 2 && pub?.rulesText === RULES && pub.registrationOpen === false);

    // ---------- Closing by date, and the incremental poll ----------
    await editions.cancelEdition(ADMIN, String(e._id), 'Fin du scénario de test');
    const e2 = await editions.createEdition(ADMIN, {
        name: 'Édition test 2', rulesText: RULES,
        schedule: { qualificationOpensAt: hours(-2), qualificationClosesAt: hours(1) },
        settings: { maxCandidates: 5, invitationsRequired: 3, waitlistSize: 0 },
    });
    await editions.openQualification(ADMIN, String(e2._id));
    const [G, H] = [newMember(), newMember()];
    await candidates.apply(G, profile('g'));
    await candidates.apply(H, profile('h'));
    reach(G, 1, null); reach(H, 1, null);
    invitationCalls.length = 0;
    await qualificationTick(); // first pass: full recount
    check('first pass recounts everyone (no cursor)', invitationCalls.length === 1 && !invitationCalls[0].changedSince);
    invitationCalls.length = 0;
    await qualificationTick(); // later passes: only what changed
    check('later passes ask only for changes since the cursor', invitationCalls.length === 1 && invitationCalls[0].changedSince instanceof Date);
    reach(G, 3, new Date());
    await qualificationTick();
    check('a new payment is picked up by the poll', (await cand(G))?.status === CandidateStatus.OFFICIAL);

    const reqClose = await editions.requestCloseQualification(ADMIN, String(e2._id), 'Fin anticipée décidée');
    check('admin close ends the window now', reqClose.schedule.qualificationClosesAt.getTime() <= Date.now());
    await new Promise((r) => setTimeout(r, 5));
    await qualificationTick();
    const e2c = await ImpactEdition.findById(e2._id);
    check('the job closes qualification after the date', e2c?.status === EditionStatus.QUALIFICATION_CLOSED && e2c.registrationClosedReason === 'admin');
    check('remaining candidates are not selected', (await cand(H))?.status === CandidateStatus.NOT_SELECTED);

    // ---------- Audit ----------
    const trail = await ImpactAudit.countDocuments({ editionId: e._id });
    check('every action is in the audit log', trail >= 15, `entries=${trail}`);

    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
    process.exit(failures ? 1 : 0);
};

main().catch(async (err) => { console.error(err); await mongoose.disconnect().catch(() => undefined); process.exit(1); });
