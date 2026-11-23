import { createHash } from 'crypto';
import { Types } from 'mongoose';
import config from '../../../config';
import { AppError } from '../../../utils/errors';
import logger from '../../../utils/logger';
import {
    createImpactVoteIntent, creditBuyerBalance, getPaymentIntentState, InsufficientBalanceError,
    refundBalanceSpend, spendFromBalance,
} from '../../../services/clients/payment.service.client';
import { getEventUserDetails, getImpactMembers } from '../../../services/clients/user.service.client';
import { notifyUser } from '../../../services/clients/notification.service.client';
import { kv } from '../../animation/lib/kv';
import {
    IImpactEdition, IImpactVoteTx, ImpactCandidate, ImpactEdition, ImpactFreeVote, ImpactSubmission, ImpactVoteTx,
} from '../models';
import {
    CandidateStatus, EditionStatus, PayMethod, RoundKey, RoundStatus, settingsOf, SubmissionKind, SubmissionStatus,
    VoteTxStatus,
} from '../types';
import { Actor, audit, SYSTEM } from '../lib';
import { currentEdition, getEdition, invalidateCurrent } from './edition.service';
import { invalidateBoard } from './board.service';

const log = logger.getLogger('ImpactVotes');

const SETTLEMENT_LEASE_MS = 10 * 60_000;
const MAX_PURCHASES_PER_HOUR = 30;
/**
 * Free votes from one network address per hour before refusing. High on
 * purpose: mobile operators put many subscribers behind one address, so this
 * only stops a farm; finer signals go to the anomaly report.
 */
const FREE_VOTES_PER_IP_HOUR = Number(process.env.IMPACT_FREE_VOTES_PER_IP_HOUR || 300);
const ELIGIBILITY_TTL_SEC = 600;

const oid = (v: unknown, what = 'Candidat') => {
    if (!Types.ObjectId.isValid(String(v))) throw new AppError(`${what} introuvable.`, 404);
    return new Types.ObjectId(String(v));
};
export const hashSignal = (v?: string) =>
    v ? createHash('sha256').update(`${config.qrTokenSecret}|impact|${v}`).digest('hex').slice(0, 32) : undefined;

/** Push only: a buyer may buy often, and e-mail is the mail server's scarcest resource. */
const pushMember = (userId: Types.ObjectId | string, kind: string, subject: string, body: string, tag?: string) =>
    notifyUser({ kind, userId: String(userId), channels: ['push'], subject, body, pushTag: tag }).catch(() => 0);

const roundOpen = (e: IImpactEdition, k: RoundKey, now = new Date()) => {
    const r = e.rounds?.[k];
    return e.status === EditionStatus.COMPETITION && r?.status === RoundStatus.OPEN && (!r.closesAt || r.closesAt > now);
};

/** The candidate can receive votes of this round: still in the race and the content published. */
const votable = async (e: IImpactEdition, candidateId: unknown, k: RoundKey) => {
    const status = k === RoundKey.FREE ? CandidateStatus.STAGE_2 : CandidateStatus.STAGE_3;
    const c = await ImpactCandidate.findOne({ _id: oid(candidateId), editionId: e._id, status });
    if (!c) throw new AppError('Ce candidat ne peut pas recevoir de votes en ce moment.', 409, true, 'CANDIDATE_NOT_VOTABLE');
    const kind = k === RoundKey.FREE ? SubmissionKind.VIDEO : SubmissionKind.PROJECT;
    if (!(await ImpactSubmission.exists({ candidateId: c._id, kind, current: true, status: SubmissionStatus.ACCEPTED }))) {
        throw new AppError(k === RoundKey.FREE ? 'La vidéo de ce candidat n’est pas encore publiée.' : 'Le projet de ce candidat n’est pas encore publié.', 409, true, 'CANDIDATE_NOT_VOTABLE');
    }
    return c;
};

// ---------- Free vote (§6.3, §17) ----------

/** Can this account vote for free? Cached 10 min per account and edition. */
const assertFreeVoter = async (e: IImpactEdition, userId: string) => {
    const st = settingsOf(e.settings);
    const key = `impact:elig:${e._id}:${userId}`;
    let verdict: { code?: string; message?: string } | null = null;
    try {
        const cached = await kv().get(key);
        if (cached) verdict = JSON.parse(cached);
    } catch { /* cache only */ }
    if (!verdict) {
        let m;
        try {
            [m] = await getImpactMembers([userId]);
        } catch {
            throw new AppError('Vérification de votre compte impossible pour le moment. Réessayez dans un instant.', 503, true, 'MEMBER_CHECK_UNAVAILABLE');
        }
        const openedAt = e.rounds?.FREE?.openedAt ?? e.rounds?.FREE?.opensAt;
        if (!m || m.unavailable) verdict = { code: 'ACCOUNT_UNAVAILABLE', message: 'Ce compte ne peut pas voter.' };
        else if (st.freeVote.membersOnly && !m.isMember) verdict = { code: 'MEMBERS_ONLY', message: 'Le vote est réservé aux membres SBC avec un pack actif.' };
        else if (st.freeVote.accountsOlderThanRound && openedAt && m.createdAt && new Date(m.createdAt) >= openedAt) {
            verdict = { code: 'ACCOUNT_TOO_RECENT', message: 'Seuls les comptes créés avant l’ouverture du vote peuvent voter.' };
        } else verdict = {};
        try { await kv().set(key, JSON.stringify(verdict), ELIGIBILITY_TTL_SEC); } catch { /* cache only */ }
    }
    if (verdict.code) throw new AppError(verdict.message!, 403, true, verdict.code);
};

/** « 1 compte SBC = 1 vote gratuit » for the week-2 video (the unique index refuses a second one). */
export const castFreeVote = async (userId: string, body: Record<string, any>, signals: { ip?: string; ua?: string }) => {
    const e = await currentEdition();
    if (!e || !roundOpen(e, RoundKey.FREE)) throw new AppError('Le vote gratuit n’est pas ouvert.', 409, true, 'VOTE_CLOSED');
    const c = await votable(e, body?.candidateId, RoundKey.FREE);
    if (!settingsOf(e.settings).freeVote.selfVote && String(c.userId) === userId) {
        throw new AppError('Vous ne pouvez pas voter pour vous-même.', 403, true, 'SELF_VOTE');
    }
    if (await ImpactFreeVote.exists({ editionId: e._id, voterUserId: new Types.ObjectId(userId) })) {
        throw new AppError('Vous avez déjà voté.', 409, true, 'ALREADY_VOTED');
    }
    await assertFreeVoter(e, userId);
    const ipHash = hashSignal(signals.ip);
    if (ipHash) {
        try {
            const hits = await kv().hit(`impact:fv:ip:${e._id}:${ipHash}`, 3600);
            if (hits > FREE_VOTES_PER_IP_HOUR) throw new AppError('Trop de votes depuis ce réseau. Réessayez plus tard.', 429, true, 'TOO_MANY_REQUESTS');
        } catch (err) {
            if (err instanceof AppError) throw err;
        }
    }
    const now = new Date();
    try {
        await ImpactFreeVote.create({ editionId: e._id, candidateId: c._id, voterUserId: new Types.ObjectId(userId), ipHash, uaHash: hashSignal(signals.ua), at: now });
    } catch (err: any) {
        if (err?.code === 11000) throw new AppError('Vous avez déjà voté.', 409, true, 'ALREADY_VOTED');
        throw err;
    }
    await ImpactCandidate.updateOne({ _id: c._id }, { $inc: { 'votes.free': 1 }, $set: { 'votes.lastFreeAt': now } });
    invalidateBoard();
    return { candidateId: String(c._id), at: now };
};

// ---------- Paid votes (§8) ----------

export const presentTx = (t: IImpactVoteTx | Record<string, any>) => ({
    _id: String(t._id),
    candidateId: String(t.candidateId),
    votes: t.votes,
    amount: t.amount,
    method: t.method,
    status: t.status,
    counted: Boolean(t.votesCreditedAt) && !t.lateSettlement && t.status === VoteTxStatus.SUCCESS,
    lateSettlement: Boolean(t.lateSettlement),
    paymentSessionId: t.paymentSessionId ?? null,
    refund: t.refund ? { reason: t.refund.reason, at: t.refund.at ?? null } : null,
    createdAt: t.createdAt,
    settledAt: t.settledAt ?? null,
});

/**
 * Starts a vote purchase. Nothing is counted here: votes exist only once
 * payment-service confirms the payment. `idempotencyKey` (one per click) makes
 * a double tap return the same purchase.
 */
export const startPurchase = async (userId: string, body: Record<string, any>, signals: { ip?: string; ua?: string }) => {
    const key = String(body?.idempotencyKey ?? '').trim();
    if (!/^[A-Za-z0-9_-]{8,100}$/.test(key)) throw new AppError('Clé de requête invalide.', 400, true, 'BAD_REQUEST');
    const existing = await ImpactVoteTx.findOne({ userId: new Types.ObjectId(userId), idempotencyKey: key });
    if (existing) {
        if (String(existing.candidateId) !== String(body?.candidateId)) {
            throw new AppError('Clé de requête déjà utilisée pour un autre achat.', 409, true, 'IDEMPOTENCY_MISMATCH');
        }
        return { transaction: presentTx(existing), sessionId: existing.paymentSessionId ?? null };
    }

    const e = await currentEdition();
    if (!e || !roundOpen(e, RoundKey.PAID)) throw new AppError('Les votes payants ne sont pas ouverts.', 409, true, 'VOTE_CLOSED');
    const st = settingsOf(e.settings);
    const c = await votable(e, body?.candidateId, RoundKey.PAID);
    if (!st.paidSelfVote && String(c.userId) === userId) throw new AppError('Vous ne pouvez pas acheter des votes pour vous-même.', 403, true, 'SELF_VOTE');
    const packIndex = Number(body?.packIndex);
    const pack = Number.isInteger(packIndex) ? st.votePacks[packIndex] : undefined;
    if (!pack) throw new AppError('Ce pack n’existe pas.', 400, true, 'BAD_PACK');
    const method = body?.method === PayMethod.BALANCE ? PayMethod.BALANCE : body?.method === PayMethod.MOBILE_MONEY ? PayMethod.MOBILE_MONEY : null;
    if (!method) throw new AppError('Moyen de paiement inconnu.', 400, true, 'BAD_METHOD');
    if (method === PayMethod.BALANCE && !st.balancePayment) throw new AppError('Le paiement par solde n’est pas proposé.', 409, true, 'BALANCE_DISABLED');

    let m;
    try {
        [m] = await getImpactMembers([userId]);
    } catch {
        throw new AppError('Vérification de votre compte impossible pour le moment. Réessayez dans un instant.', 503, true, 'MEMBER_CHECK_UNAVAILABLE');
    }
    if (!m || m.unavailable) throw new AppError('Ce compte ne peut pas voter.', 403, true, 'ACCOUNT_UNAVAILABLE');
    const recent = await ImpactVoteTx.countDocuments({ userId: new Types.ObjectId(userId), editionId: e._id, createdAt: { $gt: new Date(Date.now() - 3_600_000) } });
    if (recent >= MAX_PURCHASES_PER_HOUR) throw new AppError('Trop d’achats en une heure. Réessayez plus tard.', 429, true, 'PURCHASE_LIMIT');

    let tx: IImpactVoteTx;
    try {
        tx = await ImpactVoteTx.create({
            editionId: e._id, candidateId: c._id, userId: new Types.ObjectId(userId),
            votes: pack.votes, amount: pack.price, method, idempotencyKey: key,
            ipHash: hashSignal(signals.ip), uaHash: hashSignal(signals.ua),
        });
    } catch (err: any) {
        if (err?.code === 11000) {
            const raced = await ImpactVoteTx.findOne({ userId: new Types.ObjectId(userId), idempotencyKey: key });
            if (raced) return { transaction: presentTx(raced), sessionId: raced.paymentSessionId ?? null };
        }
        throw err;
    }
    await audit({ actor: { role: 'member', userId }, action: 'vote.purchase_started', editionId: e._id, candidateId: c._id, after: { tx: String(tx._id), votes: tx.votes, amount: tx.amount, method } });

    if (method === PayMethod.MOBILE_MONEY) {
        try {
            const intent = await createImpactVoteIntent({
                userId, amount: tx.amount, impactVoteTxId: String(tx._id), editionName: e.name, candidateName: c.profile.name, votes: tx.votes,
            });
            tx.paymentSessionId = intent.sessionId;
            await tx.save();
        } catch (err) {
            await ImpactVoteTx.updateOne({ _id: tx._id }, { $set: { status: VoteTxStatus.FAILED, providerStatus: 'INTENT_FAILED' } });
            throw err;
        }
        return { transaction: presentTx(tx), sessionId: tx.paymentSessionId ?? null };
    }
    const after = await payFromBalance(tx, c.profile.name);
    return { transaction: presentTx(after), sessionId: null };
};

/**
 * Debits the SBC balance (exactly once per reference), then settles. Too
 * little money → FAILED. Unknown outcome (payment-service unreachable) → stays
 * PENDING; the sweeper asks again with the same reference.
 */
const payFromBalance = async (tx: IImpactVoteTx, candidateName?: string): Promise<IImpactVoteTx> => {
    const reference = tx.balanceRef ?? `impact-vote:${tx._id}`;
    await ImpactVoteTx.updateOne({ _id: tx._id }, { $set: { balanceRef: reference, balanceAttemptAt: new Date() } });
    try {
        await spendFromBalance({
            userId: String(tx.userId), amount: tx.amount, reference,
            description: `SBC Impact Challenge : ${tx.votes} vote${tx.votes > 1 ? 's' : ''}${candidateName ? ` pour ${candidateName}` : ''}`,
            metadata: { impactVoteTxId: String(tx._id), editionId: String(tx.editionId) },
        });
    } catch (err) {
        if (err instanceof InsufficientBalanceError) {
            await ImpactVoteTx.updateOne({ _id: tx._id, status: VoteTxStatus.PENDING }, { $set: { status: VoteTxStatus.FAILED, providerStatus: 'INSUFFICIENT_BALANCE' } });
            throw err;
        }
        log.warn(`Balance payment of vote tx ${tx._id} has an unknown outcome: ${(err as Error).message} — the sweeper will retry.`);
        return (await ImpactVoteTx.findById(tx._id))!;
    }
    await settleImpactVote({ txId: tx._id, status: 'SUCCEEDED', verifiedAmount: tx.amount });
    return (await ImpactVoteTx.findById(tx._id))!;
};

/** Why paid votes can no longer count (the money is then refunded). */
const whyNotCountable = async (tx: IImpactVoteTx): Promise<string | null> => {
    const [e, c] = await Promise.all([
        ImpactEdition.findById(tx.editionId).select('status rounds top3 settings').lean(),
        ImpactCandidate.findById(tx.candidateId).select('status suspendedFrom').lean(),
    ]);
    if (!e) return 'édition introuvable';
    if (e.status === EditionStatus.CANCELLED) return 'édition annulée';
    if (e.top3?.decidedAt) return 'TOP 3 déjà désigné';
    const r = e.rounds?.PAID;
    if (r?.status !== RoundStatus.OPEN) {
        if (r?.status !== RoundStatus.CLOSED || !r.closedAt) return 'votes payants fermés';
        const grace = settingsOf(e.settings).settlementGraceMin * 60_000;
        if (tx.createdAt >= r.closedAt) return 'achat commencé après la clôture';
        if (Date.now() > r.closedAt.getTime() + grace) return 'paiement confirmé après la clôture des votes';
    }
    const inRace = c && (c.status === CandidateStatus.STAGE_3 || (c.status === CandidateStatus.SUSPENDED && c.suspendedFrom === CandidateStatus.STAGE_3));
    if (!inRace) return 'candidat retiré ou disqualifié';
    return null;
};

/**
 * Settles a purchase from payment-service's VERIFIED outcome (the webhook
 * controller re-reads the intent; a balance payment settles right after the
 * debit). Exactly once however often it is called: a lease admits one settler,
 * and the votes are added only by the write that sets `votesCreditedAt`.
 */
export const settleImpactVote = async (p: { sessionId?: string; txId?: Types.ObjectId | string; status: string; verifiedAmount?: number }) => {
    const tx = p.txId ? await ImpactVoteTx.findById(p.txId) : await ImpactVoteTx.findOne({ paymentSessionId: p.sessionId });
    if (!tx) return { handled: false };
    if (p.status === 'SUCCEEDED' && p.verifiedAmount !== undefined && Math.round(p.verifiedAmount) !== Math.round(tx.amount)) {
        await ImpactVoteTx.updateOne({ _id: tx._id, status: VoteTxStatus.PENDING }, {
            $set: { providerStatus: `AMOUNT_MISMATCH:${p.verifiedAmount}` }, $addToSet: { flags: 'AMOUNT_MISMATCH' },
        });
        log.error(`Impact vote tx ${tx._id}: paid ${p.verifiedAmount} for ${tx.amount} — not counted, flagged.`);
        return { handled: true, outcome: 'amount_mismatch' };
    }
    if (tx.status === VoteTxStatus.SUCCESS || tx.status === VoteTxStatus.REFUNDED) return { handled: true, alreadyProcessed: true };
    if (p.status !== 'SUCCEEDED') {
        await ImpactVoteTx.updateOne(
            { _id: tx._id, status: VoteTxStatus.PENDING, settlingAt: { $exists: false } },
            { $set: { status: p.status === 'CANCELED' ? VoteTxStatus.CANCELLED : VoteTxStatus.FAILED, providerStatus: p.status } },
        );
        return { handled: true, outcome: 'failed' };
    }
    // A late provider success can still turn a FAILED/CANCELLED purchase into a paid one.
    const claimed = await ImpactVoteTx.findOneAndUpdate(
        {
            _id: tx._id,
            status: { $in: [VoteTxStatus.PENDING, VoteTxStatus.FAILED, VoteTxStatus.CANCELLED] },
            $or: [{ settlingAt: { $exists: false } }, { settlingAt: { $lt: new Date(Date.now() - SETTLEMENT_LEASE_MS) } }],
        },
        { $set: { settlingAt: new Date(), providerStatus: p.status } },
        { new: true },
    );
    if (!claimed) return { handled: true, alreadyProcessed: true };

    const why = await whyNotCountable(claimed);
    if (why) {
        await ImpactVoteTx.updateOne({ _id: claimed._id }, { $set: { status: VoteTxStatus.SUCCESS, lateSettlement: true, settledAt: new Date() } });
        log.warn(`Impact vote tx ${claimed._id} paid but not countable (${why}) — refunding to the SBC balance.`);
        await audit({ actor: SYSTEM, action: 'vote.late_refund', editionId: claimed.editionId, candidateId: claimed.candidateId, after: { tx: String(claimed._id), amount: claimed.amount }, reason: why });
        await refundMoney(claimed, `Votes non comptés : ${why}`, SYSTEM);
        return { handled: true, outcome: 'refunded_late' };
    }
    const now = new Date();
    const credited = await ImpactVoteTx.findOneAndUpdate(
        { _id: claimed._id, votesCreditedAt: { $exists: false } },
        { $set: { status: VoteTxStatus.SUCCESS, settledAt: now, votesCreditedAt: now } },
        { new: true },
    );
    if (credited) {
        await ImpactCandidate.updateOne({ _id: claimed.candidateId }, {
            $inc: { 'votes.paid': claimed.votes, 'votes.paidAmount': claimed.amount }, $set: { 'votes.lastPaidAt': now },
        });
        invalidateBoard();
        const c = await ImpactCandidate.findById(claimed.candidateId).select('profile.name').lean();
        await pushMember(claimed.userId, 'impact-votes-bought', 'SBC Impact Challenge : votes comptés',
            `Merci ! Tes ${claimed.votes} vote${claimed.votes > 1 ? 's' : ''} pour ${c?.profile?.name ?? 'ton candidat'} sont comptés.`, `impact-votes-bought-${claimed._id}`);
    } else {
        await ImpactVoteTx.updateOne({ _id: claimed._id }, { $set: { status: VoteTxStatus.SUCCESS } });
    }
    return { handled: true, outcome: 'paid', transactionId: String(claimed._id) };
};

/**
 * Gives the money back to the buyer's SBC balance. Both routes are exactly
 * once per reference, so a retry never pays twice; an unknown outcome is
 * marked `refund.uncertain` and retried by the job.
 */
const refundMoney = async (tx: IImpactVoteTx, reason: string, actor: Actor): Promise<boolean> => {
    const reference = `impact-vote-refund:${tx._id}`;
    await ImpactVoteTx.updateOne(
        { _id: tx._id, 'refund.claimedAt': { $exists: false } },
        { $set: { refund: { reason, claimedAt: new Date(), reference, by: actor.userId && Types.ObjectId.isValid(actor.userId) ? new Types.ObjectId(actor.userId) : null } } },
    );
    const description = `SBC Impact Challenge : remboursement de ${tx.votes} vote${tx.votes > 1 ? 's' : ''}`;
    try {
        if (tx.method === PayMethod.BALANCE) {
            await refundBalanceSpend({ userId: String(tx.userId), reference: tx.balanceRef ?? `impact-vote:${tx._id}`, description });
        } else {
            await creditBuyerBalance({ userId: String(tx.userId), amount: tx.amount, description, reference });
        }
    } catch (err) {
        await ImpactVoteTx.updateOne({ _id: tx._id }, { $set: { 'refund.uncertain': true } });
        log.error(`Refund of impact vote tx ${tx._id} failed: ${(err as Error).message} — the job will retry (same reference).`);
        return false;
    }
    await ImpactVoteTx.updateOne({ _id: tx._id }, { $set: { status: VoteTxStatus.REFUNDED, 'refund.at': new Date(), 'refund.uncertain': false } });
    await pushMember(tx.userId, 'impact-votes-refunded', 'SBC Impact Challenge : remboursement',
        `${tx.amount} F te sont rendus sur ton solde SBC : ${reason}.`, `impact-votes-refunded-${tx._id}`);
    return true;
};

/**
 * Administration refund (admin code required at the route): the votes are
 * removed, the money goes back to the buyer's SBC balance. Not after the TOP 3
 * is set: the podium is frozen.
 */
export const refundPurchase = async (actor: Actor, txId: string, body: Record<string, any>) => {
    const reason = String(body?.reason ?? '').trim();
    if (reason.length < 10) throw new AppError('Indiquez la raison (10 caractères au moins) : l’acheteur la lit.', 400, true, 'REASON_REQUIRED');
    const tx = await ImpactVoteTx.findById(oid(txId, 'Achat'));
    if (!tx) throw new AppError('Achat introuvable.', 404);
    if (tx.status !== VoteTxStatus.SUCCESS) throw new AppError('Seul un achat payé peut être remboursé.', 409, true, 'NOT_REFUNDABLE');
    if (tx.refund?.claimedAt) throw new AppError('Un remboursement est déjà en cours pour cet achat.', 409, true, 'REFUND_IN_PROGRESS');
    const e = await ImpactEdition.findById(tx.editionId).select('top3').lean();
    if (e?.top3?.decidedAt) throw new AppError('Le TOP 3 est désigné : les votes ne changent plus.', 409, true, 'ALREADY_DECIDED');
    // Remove the votes first (once), so a refunded purchase never counts.
    const removed = await ImpactVoteTx.findOneAndUpdate(
        { _id: tx._id, votesCreditedAt: { $exists: true }, lateSettlement: { $ne: true }, 'refund.claimedAt': { $exists: false } },
        { $set: { lateSettlement: true } },
        { new: true },
    );
    if (removed) {
        await ImpactCandidate.updateOne({ _id: tx.candidateId }, { $inc: { 'votes.paid': -tx.votes, 'votes.paidAmount': -tx.amount } });
        invalidateBoard();
    }
    await audit({ actor, action: 'vote.refunded_by_admin', editionId: tx.editionId, candidateId: tx.candidateId, after: { tx: String(tx._id), amount: tx.amount, votes: tx.votes }, reason });
    const ok = await refundMoney(tx, reason, actor);
    return { ...presentTx((await ImpactVoteTx.findById(tx._id))!), refundCompleted: ok };
};

// ---------- Jobs ----------

/** Mobile Money purchases whose callback never came: ask payment-service. */
export const reconcilePurchases = async (): Promise<number> => {
    const now = Date.now();
    const pending = await ImpactVoteTx.find({
        status: VoteTxStatus.PENDING, method: PayMethod.MOBILE_MONEY, paymentSessionId: { $type: 'string' },
        createdAt: { $lt: new Date(now - 10 * 60_000), $gt: new Date(now - 7 * 86_400_000) },
        $or: [{ reconciledAt: { $exists: false } }, { reconciledAt: { $lt: new Date(now - 10 * 60_000) } }],
    }).sort({ createdAt: 1 }).limit(50).select('_id paymentSessionId createdAt').lean();
    let n = 0;
    for (const t of pending) {
        try {
            const intent = await getPaymentIntentState(String(t.paymentSessionId));
            await ImpactVoteTx.updateOne({ _id: t._id }, { $set: { reconciledAt: new Date() } });
            const st = intent?.status;
            if (st === 'SUCCEEDED' || st === 'CONFIRMED') {
                const r = await settleImpactVote({ sessionId: String(t.paymentSessionId), status: 'SUCCEEDED', verifiedAmount: intent?.amount });
                if ('outcome' in r && r.outcome === 'paid') n++;
            } else if (st && ['FAILED', 'CANCELED', 'EXPIRED', 'ERROR'].includes(st)) {
                await settleImpactVote({ sessionId: String(t.paymentSessionId), status: st });
            } else if (now - new Date(t.createdAt).getTime() > 24 * 3_600_000) {
                await ImpactVoteTx.updateOne({ _id: t._id, status: VoteTxStatus.PENDING }, { $set: { status: VoteTxStatus.CANCELLED, providerStatus: st ?? 'EXPIRED' } });
            }
        } catch (err) {
            log.warn(`reconcile impact vote tx ${t._id}: ${(err as Error).message}`);
        }
    }
    return n;
};

/**
 * Balance payments with an unknown outcome. Within 30 min, ask again with the
 * same reference (it either finds the earlier debit or makes it). Past that,
 * give back whatever was taken under the reference and cancel: a member must
 * not be charged long after they tapped.
 */
export const sweepBalancePayments = async (): Promise<number> => {
    const now = Date.now();
    const stuck = await ImpactVoteTx.find({
        status: VoteTxStatus.PENDING, method: PayMethod.BALANCE, balanceAttemptAt: { $lt: new Date(now - 2 * 60_000) },
    }).limit(50);
    let n = 0;
    for (const t of stuck) {
        try {
            if (now - t.createdAt.getTime() < 30 * 60_000) {
                await payFromBalance(t);
            } else {
                await refundBalanceSpend({ userId: String(t.userId), reference: t.balanceRef ?? `impact-vote:${t._id}`, description: 'SBC Impact Challenge : paiement annulé' });
                await ImpactVoteTx.updateOne({ _id: t._id, status: VoteTxStatus.PENDING }, { $set: { status: VoteTxStatus.CANCELLED, providerStatus: 'BALANCE_TIMEOUT' } });
            }
            n++;
        } catch (err) {
            log.warn(`balance sweep of impact vote tx ${t._id}: ${(err as Error).message}`);
        }
    }
    return n;
};

/** Refunds whose outcome was unknown: retry with the same reference. */
export const retryRefunds = async (): Promise<number> => {
    const due = await ImpactVoteTx.find({ 'refund.claimedAt': { $exists: true }, status: { $ne: VoteTxStatus.REFUNDED } }).limit(50);
    let n = 0;
    for (const t of due) if (await refundMoney(t, t.refund!.reason, SYSTEM)) n++;
    return n;
};

// ---------- Reads ----------

export const myVotes = async (userId: string) => {
    const e = await currentEdition();
    if (!e) return { freeVote: null, purchases: [] };
    const [fv, txs] = await Promise.all([
        ImpactFreeVote.findOne({ editionId: e._id, voterUserId: new Types.ObjectId(userId) }).lean(),
        ImpactVoteTx.find({ editionId: e._id, userId: new Types.ObjectId(userId) }).sort({ createdAt: -1 }).limit(50).lean(),
    ]);
    return { freeVote: fv ? { candidateId: String(fv.candidateId), at: fv.at } : null, purchases: txs.map(presentTx) };
};

export const getMyPurchase = async (userId: string, txId: string) => {
    const t = await ImpactVoteTx.findOne({ _id: oid(txId, 'Achat'), userId: new Types.ObjectId(userId) }).lean();
    if (!t) throw new AppError('Achat introuvable.', 404);
    return presentTx(t);
};

const names = async (ids: string[]) => {
    if (!ids.length) return new Map<string, string>();
    try {
        return new Map((await getEventUserDetails([...new Set(ids)])).map((u) => [String(u._id), u.name ?? '']));
    } catch {
        return new Map<string, string>();
    }
};

export const listFreeVotes = async (editionId: string, q: Record<string, any>) => {
    const e = await getEdition(editionId);
    const filter: Record<string, unknown> = { editionId: e._id };
    if (q.candidateId && Types.ObjectId.isValid(String(q.candidateId))) filter.candidateId = new Types.ObjectId(String(q.candidateId));
    const page = Math.max(1, Number(q.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(q.limit) || 50));
    const [rows, total] = await Promise.all([
        ImpactFreeVote.find(filter).sort({ at: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
        ImpactFreeVote.countDocuments(filter),
    ]);
    const n = await names(rows.map((r) => String(r.voterUserId)));
    return {
        items: rows.map((r) => ({ _id: String(r._id), candidateId: String(r.candidateId), voterUserId: String(r.voterUserId), voterName: n.get(String(r.voterUserId)) ?? null, at: r.at })),
        total, page, limit,
    };
};

export const listPurchases = async (editionId: string, q: Record<string, any>) => {
    const e = await getEdition(editionId);
    const filter: Record<string, unknown> = { editionId: e._id };
    if (q.status && Object.values(VoteTxStatus).includes(q.status)) filter.status = q.status;
    if (q.method && Object.values(PayMethod).includes(q.method)) filter.method = q.method;
    if (q.candidateId && Types.ObjectId.isValid(String(q.candidateId))) filter.candidateId = new Types.ObjectId(String(q.candidateId));
    if (q.flagged === '1' || q.flagged === 'true') filter.flags = { $ne: [] };
    const page = Math.max(1, Number(q.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(q.limit) || 50));
    const [rows, total, totals] = await Promise.all([
        ImpactVoteTx.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
        ImpactVoteTx.countDocuments(filter),
        ImpactVoteTx.aggregate([
            { $match: { editionId: e._id } },
            {
                $group: {
                    _id: '$status', n: { $sum: 1 }, amount: { $sum: '$amount' }, votes: { $sum: '$votes' },
                    counted: { $sum: { $cond: [{ $and: [{ $gt: ['$votesCreditedAt', null] }, { $ne: ['$lateSettlement', true] }] }, '$votes', 0] } },
                },
            },
        ]),
    ]);
    const n = await names(rows.map((r) => String(r.userId)));
    const byStatus = Object.fromEntries(totals.map((t) => [t._id, { count: t.n, amount: t.amount, votes: t.votes, countedVotes: t.counted }]));
    const success = byStatus[VoteTxStatus.SUCCESS];
    return {
        items: rows.map((r) => ({ ...presentTx(r), userId: String(r.userId), buyerName: n.get(String(r.userId)) ?? null, flags: r.flags, refundUncertain: Boolean(r.refund?.uncertain), providerStatus: r.providerStatus ?? null })),
        total, page, limit,
        // Revenue = paid purchases that were not refunded (late ones are refunded).
        totals: { byStatus, revenue: (success?.amount ?? 0), countedVotes: success?.countedVotes ?? 0 },
    };
};

/**
 * What looks unusual (spec §17): many free voters on one network or device,
 * bursts towards one candidate, heavy buyers, flagged purchases, refunds that
 * could not complete. Signals only: nothing is cancelled automatically.
 */
export const anomalies = async (editionId: string) => {
    const e = await getEdition(editionId);
    const since = new Date(Date.now() - 7 * 86_400_000);
    const [byIp, byUa, bursts, buyers, flagged, stuckRefunds] = await Promise.all([
        ImpactFreeVote.aggregate([
            { $match: { editionId: e._id, ipHash: { $exists: true } } },
            { $group: { _id: '$ipHash', voters: { $sum: 1 }, candidates: { $addToSet: '$candidateId' } } },
            { $match: { voters: { $gte: 10 } } }, { $sort: { voters: -1 } }, { $limit: 20 },
        ]),
        ImpactFreeVote.aggregate([
            { $match: { editionId: e._id, uaHash: { $exists: true } } },
            { $group: { _id: '$uaHash', voters: { $sum: 1 } } },
            { $match: { voters: { $gte: 25 } } }, { $sort: { voters: -1 } }, { $limit: 20 },
        ]),
        ImpactFreeVote.aggregate([
            { $match: { editionId: e._id, at: { $gte: since } } },
            { $group: { _id: { c: '$candidateId', b: { $dateTrunc: { date: '$at', unit: 'minute', binSize: 10 } } }, n: { $sum: 1 } } },
            { $match: { n: { $gte: 50 } } }, { $sort: { n: -1 } }, { $limit: 20 },
        ]),
        ImpactVoteTx.aggregate([
            { $match: { editionId: e._id, status: VoteTxStatus.SUCCESS, lateSettlement: { $ne: true } } },
            { $group: { _id: '$userId', amount: { $sum: '$amount' }, votes: { $sum: '$votes' }, purchases: { $sum: 1 }, candidates: { $addToSet: '$candidateId' } } },
            { $sort: { amount: -1 } }, { $limit: 20 },
        ]),
        ImpactVoteTx.find({ editionId: e._id, flags: { $ne: [] } }).sort({ createdAt: -1 }).limit(50).lean(),
        ImpactVoteTx.find({ editionId: e._id, 'refund.uncertain': true }).limit(50).lean(),
    ]);
    const n = await names(buyers.map((b) => String(b._id)));
    return {
        freeVotes: {
            sharedNetworks: byIp.map((r) => ({ network: r._id.slice(0, 8), voters: r.voters, candidates: r.candidates.length })),
            sharedDevices: byUa.map((r) => ({ device: r._id.slice(0, 8), voters: r.voters })),
            bursts: bursts.map((r) => ({ candidateId: String(r._id.c), at: r._id.b, votes: r.n })),
        },
        paidVotes: {
            topBuyers: buyers.map((b) => ({ userId: String(b._id), name: n.get(String(b._id)) ?? null, amount: b.amount, votes: b.votes, purchases: b.purchases, candidates: b.candidates.length })),
            flagged: flagged.map((t) => ({ ...presentTx(t), flags: t.flags, providerStatus: t.providerStatus ?? null })),
            uncertainRefunds: stuckRefunds.map((t) => presentTx(t)),
        },
    };
};

/** Used by the jobs: the counters invalidated by a round change. */
export const touchBoards = () => { invalidateBoard(); invalidateCurrent(); };
