import { createHash, createHmac, randomBytes } from 'crypto';
import { Types } from 'mongoose';
import { AppError } from '../../../utils/errors';
import logger from '../../../utils/logger';
import { getEventUserDetails } from '../../../services/clients/user.service.client';
import {
    IImpactEdition, IImpactTombolaDraw, ImpactEdition, ImpactTombolaDraw, ImpactVoteTx, TicketSegment, TombolaWinner,
} from '../models';
import { EditionStatus, RoundStatus, settingsOf, TicketTier, VoteTxStatus } from '../types';
import { Actor, audit, notifyCandidate } from '../lib';
import { currentEdition, getEdition } from './edition.service';

const log = logger.getLogger('ImpactTombola');

/**
 * SBC Tombola (spec §13), with Rufus's rules (2026-11-23):
 *  - 1 counted paid vote = 1 ticket, numbered in the order the votes were
 *    counted (then purchase id): purchase n°1's 5 votes are tickets 1–5…;
 *  - a member's n-th ticket of the edition weighs settings.ticketTiers
 *    (1 for tickets 1–10, ½ for 11–50, ¼ beyond), so a big buyer gains less
 *    with each extra ticket and everyone keeps a chance;
 *  - the prizes are drawn in their configured order; one prize per member per
 *    draw; a member who won the same prize category within
 *    settings.prizeCooldownDays (365) is left out of that prize.
 *
 * Fair and checkable draw (commit–reveal): a random 32-byte seed is fixed and
 * its sha256 published at the commitment, ideally while the paid votes are
 * still open, before anyone knows the final tickets. The draw reveals the
 * seed; the winners follow from the seed and the published ticket list alone
 * (method below), so anyone can recompute them from the proof.
 *
 * Method, per prize (order k = 1, 2, …):
 *  1. eligible = the ticket segments whose holder is not excluded for k;
 *  2. W = Σ (to − from + 1) × weight, weights as integers (weight × 10 000);
 *  3. x = the first 6 bytes of HMAC-SHA256(seed, "<drawId>|<k>|<attempt>") as
 *     an integer, attempt = 0, 1, … until x < ⌊2⁴⁸ / W⌋ × W (no modulo bias);
 *  4. r = x mod W; walk the eligible segments in ticket order, subtracting
 *     each one's weight; the segment where r falls holds the ticket
 *     from + ⌊r / weight⌋.
 */

export const WEIGHT_SCALE = 10_000;
const TWO_48 = 2 ** 48;

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const holderHashOf = (userId: string, drawKey: string) => sha256(`${userId}:${drawKey}`);

/** Weight (integer, × WEIGHT_SCALE) of a member's n-th ticket (1-based). */
export const tierWeight = (n: number, tiers: TicketTier[]) => {
    for (const t of tiers) if (t.upTo === null || n <= t.upTo) return Math.round(t.weight * WEIGHT_SCALE);
    return Math.round(tiers[tiers.length - 1].weight * WEIGHT_SCALE);
};

/**
 * The edition's tickets as segments (consecutive tickets of one holder with the
 * same weight). Only counted purchases: SUCCESS, votes credited, not late, not
 * refunded. `drawKey` salts the public holder hashes.
 */
export const buildTickets = async (e: IImpactEdition, drawKey: string) => {
    const tiers = settingsOf(e.settings).ticketTiers;
    const txs = await ImpactVoteTx.find({
        editionId: e._id, status: VoteTxStatus.SUCCESS, votesCreditedAt: { $exists: true }, lateSettlement: { $ne: true },
    }).sort({ votesCreditedAt: 1, _id: 1 }).select('userId votes').lean();
    const perHolder = new Map<string, number>();
    const segments: TicketSegment[] = [];
    let next = 1;
    for (const t of txs) {
        const uid = String(t.userId);
        let seen = perHolder.get(uid) ?? 0;
        let left = t.votes;
        while (left > 0) {
            const w = tierWeight(seen + 1, tiers);
            // How many of the next tickets keep this weight (until the tier's end).
            const tier = tiers.find((x) => x.upTo === null || seen + 1 <= x.upTo)!;
            const room = tier.upTo === null ? left : Math.min(left, tier.upTo - seen);
            const last = segments[segments.length - 1];
            if (last && last.userId && String(last.userId) === uid && last.weight === w && last.to === next - 1) {
                last.to += room; // contiguous, same holder and weight
            } else {
                segments.push({ from: next, to: next + room - 1, weight: w, holderHash: holderHashOf(uid, drawKey), userId: t.userId as Types.ObjectId });
            }
            next += room; seen += room; left -= room;
        }
        perHolder.set(uid, seen);
    }
    const totalWeight = segments.reduce((s, g) => s + (g.to - g.from + 1) * g.weight, 0);
    return { segments, totalTickets: next - 1, participants: perHolder.size, totalWeight };
};

/** The canonical text of the segments (what the published hash covers). */
const canonical = (segments: TicketSegment[]) => segments.map((g) => `${g.from}-${g.to}:${g.weight}:${g.holderHash}`).join('\n');

/** Uniform integer in [0, total) from the seed (rejection sampling, no modulo bias). */
export const uniform = (seed: string, drawId: string, order: number, total: number) => {
    if (!(total > 0) || total >= TWO_48) throw new Error('bad total');
    const limit = Math.floor(TWO_48 / total) * total;
    for (let attempt = 0; attempt < 1000; attempt++) {
        const h = createHmac('sha256', Buffer.from(seed, 'hex')).update(`${drawId}|${order}|${attempt}`).digest();
        const x = h.readUIntBE(0, 6);
        if (x < limit) return { value: x % total, attempts: attempt + 1 };
    }
    throw new Error('no sample'); // probability ~0
};

/** One prize: the ticket chosen among the eligible segments. */
export const pickTicket = (seed: string, drawId: string, order: number, segments: TicketSegment[], excluded: Set<string>) => {
    const eligible = segments.filter((g) => !excluded.has(g.holderHash));
    const W = eligible.reduce((s, g) => s + (g.to - g.from + 1) * g.weight, 0);
    if (W === 0) return null;
    const { value, attempts } = uniform(seed, drawId, order, W);
    let r = value;
    for (const g of eligible) {
        const span = (g.to - g.from + 1) * g.weight;
        if (r < span) return { ticketNumber: g.from + Math.floor(r / g.weight), segment: g, attempts };
        r -= span;
    }
    throw new Error('walk overflow'); // impossible: r < W
};

const displayName = (full?: string | null) => {
    const parts = String(full ?? '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return 'Membre SBC';
    return parts.length === 1 ? parts[0] : `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
};

const oid = (v: unknown, what = 'Ressource') => {
    if (!Types.ObjectId.isValid(String(v))) throw new AppError(`${what} introuvable.`, 404);
    return new Types.ObjectId(String(v));
};

// ---------- Administration ----------

/** The tombola of an edition: the draw (seed hidden until drawn), the live ticket count, what can be done. */
export const overview = async (editionId: string) => {
    const e = await getEdition(editionId);
    const draw = await ImpactTombolaDraw.findOne({ editionId: e._id }).select('+seed').lean();
    const t = draw?.status === 'DONE' && draw.snapshot
        ? { totalTickets: draw.snapshot.totalTickets, participants: draw.snapshot.participants, totalWeight: draw.snapshot.totalWeight, segments: draw.snapshot.segments }
        : await buildTickets(e, 'preview');
    // Biggest holders and their share of the chances (first prize).
    const byHolder = new Map<string, { tickets: number; weight: number }>();
    for (const g of t.segments) {
        const k = String(g.userId);
        const cur = byHolder.get(k) ?? { tickets: 0, weight: 0 };
        cur.tickets += g.to - g.from + 1; cur.weight += (g.to - g.from + 1) * g.weight;
        byHolder.set(k, cur);
    }
    const top = [...byHolder.entries()].sort((a, b) => b[1].weight - a[1].weight).slice(0, 10);
    let names = new Map<string, string>();
    try { names = new Map((await getEventUserDetails(top.map(([k]) => k))).map((u) => [String(u._id), u.name ?? ''])); } catch { /* names optional */ }
    const blockers: { code: string; message: string }[] = [];
    if (!draw) blockers.push({ code: 'NOT_COMMITTED', message: 'Fixez d’abord la graine du tirage (engagement public).' });
    if (!e.top3?.decidedAt) blockers.push({ code: 'TICKETS_NOT_FINAL', message: 'Les tickets sont définitifs une fois le TOP 3 désigné.' });
    if (t.totalTickets === 0) blockers.push({ code: 'NO_TICKETS', message: 'Aucun ticket : aucun vote payant compté.' });
    return {
        // The seed is shown once drawn (it is public then, in the proof).
        draw: draw ? publicDraw(draw, { admin: true, withSeed: draw.status === 'DONE' }) : null,
        tickets: {
            totalTickets: t.totalTickets, participants: t.participants, totalWeight: t.totalWeight, weightScale: WEIGHT_SCALE,
            topHolders: top.map(([k, v]) => ({ userId: k, name: names.get(k) ?? null, tickets: v.tickets, sharePct: t.totalWeight ? Math.round((v.weight / t.totalWeight) * 10000) / 100 : 0 })),
        },
        prizes: draw?.status === 'DONE' ? draw.prizes : settingsOf(e.settings).prizes,
        tiers: settingsOf(e.settings).ticketTiers,
        cooldownDays: settingsOf(e.settings).prizeCooldownDays,
        paidRoundClosed: e.rounds?.PAID?.status === RoundStatus.CLOSED,
        canCommit: !draw && ![EditionStatus.DRAFT, EditionStatus.CANCELLED].includes(e.status),
        canDraw: draw?.status === 'COMMITTED' && blockers.length === 0,
        blockers: draw?.status === 'DONE' ? [] : blockers,
    };
};

/**
 * Fixes the seed and publishes its sha256. Best done while the paid votes are
 * still open: the seed then cannot have been chosen knowing the tickets.
 */
export const commitDraw = async (actor: Actor, editionId: string) => {
    const e = await getEdition(editionId);
    if ([EditionStatus.DRAFT, EditionStatus.CANCELLED].includes(e.status)) throw new AppError('Cette édition n’a pas de tombola.', 409, true, 'BAD_STATUS');
    const seed = randomBytes(32).toString('hex');
    const before = e.rounds?.PAID?.status !== RoundStatus.CLOSED;
    try {
        const d = await ImpactTombolaDraw.create({
            editionId: e._id, seedCommitment: sha256(seed), seed, committedAt: new Date(), committedBy: oid(actor.userId),
            committedBeforeTicketsClosed: before, weightScale: WEIGHT_SCALE, prizes: [], winners: [],
        });
        await audit({ actor, action: 'tombola.committed', editionId: e._id, after: { drawId: String(d._id), seedCommitment: d.seedCommitment, committedBeforeTicketsClosed: before } });
        invalidateTombola();
        return publicDraw(d.toObject(), { admin: true });
    } catch (err: any) {
        if (err?.code === 11000) throw new AppError('La graine de cette édition est déjà fixée.', 409, true, 'ALREADY_COMMITTED');
        throw err;
    }
};

/**
 * The draw (admin code at the route). Tickets frozen, exclusions computed,
 * winners chosen from the committed seed, everything recorded at once and
 * for good; the seed is revealed. The live screen then reveals the winners one
 * by one (`reveal`), which changes nothing in the result.
 */
export const runDraw = async (actor: Actor, editionId: string) => {
    const e = await getEdition(editionId);
    const draw = await ImpactTombolaDraw.findOne({ editionId: e._id }).select('+seed');
    if (!draw) throw new AppError('Fixez d’abord la graine du tirage.', 409, true, 'NOT_COMMITTED');
    if (draw.status !== 'COMMITTED') throw new AppError('Le tirage a déjà eu lieu.', 409, true, 'ALREADY_DRAWN');
    if (!e.top3?.decidedAt) throw new AppError('Les tickets sont définitifs une fois le TOP 3 désigné.', 409, true, 'TICKETS_NOT_FINAL');
    const st = settingsOf(e.settings);
    const drawId = String(draw._id);
    const t = await buildTickets(e, drawId);
    if (t.totalTickets === 0) throw new AppError('Aucun ticket : aucun vote payant compté.', 409, true, 'NO_TICKETS');
    const now = new Date();
    const since = new Date(now.getTime() - st.prizeCooldownDays * 86_400_000);
    const holders = [...new Set(t.segments.map((g) => String(g.userId)))].map((u) => new Types.ObjectId(u));
    // Past wins of these holders, by category, within the cooldown (other draws).
    const past = await ImpactTombolaDraw.find({
        _id: { $ne: draw._id }, status: 'DONE', drawnAt: { $gte: since }, 'winners.userId': { $in: holders },
    }).select('winners drawnAt').lean();
    const wonCategory = new Map<string, Set<string>>(); // category → userIds
    for (const d of past) for (const w of d.winners) {
        if (!w.userId || !w.ticketNumber) continue;
        if (!wonCategory.has(w.category)) wonCategory.set(w.category, new Set());
        wonCategory.get(w.category)!.add(String(w.userId));
    }
    const hashOfUser = new Map(t.segments.map((g) => [String(g.userId), g.holderHash]));

    const winners: TombolaWinner[] = [];
    const exclusions: { order: number; holderHashes: string[] }[] = [];
    const alreadyWon = new Set<string>(); // holder hashes
    const prizes = st.prizes.map((p) => ({ key: p.key, label: p.label, category: p.category }));
    prizes.forEach((p, i) => {
        const order = i + 1;
        const excluded = new Set<string>(alreadyWon);
        for (const u of wonCategory.get(p.category) ?? []) { const h = hashOfUser.get(u); if (h) excluded.add(h); }
        exclusions.push({ order, holderHashes: [...excluded].sort() });
        const pick = pickTicket(draw.seed, drawId, order, t.segments, excluded);
        if (!pick) {
            winners.push({ order, prizeKey: p.key, prizeLabel: p.label, category: p.category, ticketNumber: null, userId: null, holderHash: null, displayName: null, attempts: 0, status: 'NOT_AWARDED' });
            return;
        }
        alreadyWon.add(pick.segment.holderHash);
        winners.push({
            order, prizeKey: p.key, prizeLabel: p.label, category: p.category, ticketNumber: pick.ticketNumber,
            userId: pick.segment.userId as Types.ObjectId, holderHash: pick.segment.holderHash, displayName: null, attempts: pick.attempts, status: 'PENDING',
        });
    });
    try {
        const names = new Map((await getEventUserDetails(winners.filter((w) => w.userId).map((w) => String(w.userId)))).map((u) => [String(u._id), u.name ?? '']));
        for (const w of winners) if (w.userId) w.displayName = displayName(names.get(String(w.userId)));
    } catch {
        for (const w of winners) if (w.userId) w.displayName = 'Membre SBC';
    }
    const segmentsHash = sha256(canonical(t.segments));
    const done = await ImpactTombolaDraw.findOneAndUpdate(
        { _id: draw._id, status: 'COMMITTED' },
        {
            $set: {
                status: 'DONE', drawnAt: now, drawnBy: oid(actor.userId), prizes, winners, revealedCount: 0,
                snapshot: { totalTickets: t.totalTickets, participants: t.participants, totalWeight: t.totalWeight, segmentsHash, segments: t.segments, exclusions, cooldownDays: st.prizeCooldownDays },
            },
        },
        { new: true },
    ).select('+seed');
    if (!done) throw new AppError('Le tirage a déjà eu lieu.', 409, true, 'ALREADY_DRAWN');
    // On the edition too: the prizes are locked from now on (the admin page reads it).
    await ImpactEdition.updateOne({ _id: e._id }, { $set: { tombolaDrawnAt: now } }, { timestamps: false });
    await audit({ actor, action: 'tombola.drawn', editionId: e._id, after: { drawId, segmentsHash, winners: winners.map((w) => ({ order: w.order, ticket: w.ticketNumber, user: w.userId ? String(w.userId) : null })) } });
    // Winners are told when the live screen reveals them (reveal), not now: a phone
    // buzzing before the reveal would spoil the live.
    invalidateTombola();
    log.info(`Edition ${e._id}: tombola drawn (${t.totalTickets} tickets, ${t.participants} participants)`);
    return publicDraw(done.toObject(), { admin: true, withSeed: true });
};

/** The live screen shows one more winner (presentation only). */
export const reveal = async (actor: Actor, editionId: string) => {
    const e = await getEdition(editionId);
    const d = await ImpactTombolaDraw.findOne({ editionId: e._id, status: 'DONE' });
    if (!d) throw new AppError('Le tirage n’a pas encore eu lieu.', 409, true, 'NOT_DRAWN');
    const done = await ImpactTombolaDraw.findOneAndUpdate(
        { _id: d._id, revealedCount: { $lt: d.winners.length } },
        { $inc: { revealedCount: 1 } },
        { new: true },
    );
    if (!done) throw new AppError('Tous les gagnants sont déjà affichés.', 409, true, 'ALL_REVEALED');
    invalidateTombola();
    const w = done.winners[done.revealedCount - 1];
    if (w?.userId) {
        await notifyCandidate({ _id: done._id, userId: w.userId } as any, 'impact-tombola-won', 'SBC Tombola : vous avez gagné ! 🎉',
            `Votre ticket n°${w.ticketNumber} a gagné « ${w.prizeLabel} » au tirage de la tombola « ${e.name} ». L’équipe SBC vous contacte pour la remise du lot.`);
    }
    await audit({ actor, action: 'tombola.revealed', editionId: e._id, after: { revealedCount: done.revealedCount } });
    return publicDraw(done.toObject(), { admin: true });
};

/** A prize's status (§13.2): delivered, or forfeited, with a note. */
export const setWinnerStatus = async (actor: Actor, editionId: string, order: number, body: Record<string, any>) => {
    const e = await getEdition(editionId);
    const status = body?.status;
    if (status !== 'DELIVERED' && status !== 'FORFEITED' && status !== 'PENDING') throw new AppError('Statut : DELIVERED, FORFEITED ou PENDING.', 400, true, 'BAD_STATUS');
    const note = String(body?.note ?? '').trim().slice(0, 500);
    if (status === 'FORFEITED' && note.length < 5) throw new AppError('Indiquez pourquoi le lot n’est pas remis (5 caractères au moins).', 400, true, 'REASON_REQUIRED');
    const done = await ImpactTombolaDraw.findOneAndUpdate(
        { editionId: e._id, status: 'DONE', winners: { $elemMatch: { order: Number(order), userId: { $ne: null } } } },
        { $set: { 'winners.$.status': status, 'winners.$.statusNote': note || undefined, 'winners.$.statusAt': new Date(), 'winners.$.statusBy': oid(actor.userId) } },
        { new: true },
    );
    if (!done) throw new AppError('Gagnant introuvable.', 404);
    invalidateTombola();
    await audit({ actor, action: 'tombola.prize_status', editionId: e._id, after: { order: Number(order), status }, reason: note || undefined });
    return publicDraw(done.toObject(), { admin: true });
};

/** Every draw done, newest first (§13.2: édition, date, n° du ticket, gagnant, lot, statut). */
export const history = async (opts: { admin: boolean }) => {
    const draws = await ImpactTombolaDraw.find({ status: 'DONE' }).sort({ drawnAt: -1 }).limit(100).lean();
    const eds = await ImpactEdition.find({ _id: { $in: draws.map((d) => d.editionId) } }).select('name').lean();
    const nameOf = new Map(eds.map((x) => [String(x._id), x.name]));
    return draws.map((d) => ({
        drawId: String(d._id), editionId: String(d.editionId), editionName: nameOf.get(String(d.editionId)) ?? null, drawnAt: d.drawnAt,
        totalTickets: d.snapshot?.totalTickets ?? 0, participants: d.snapshot?.participants ?? 0,
        winners: d.winners.map((w) => ({
            order: w.order, prize: w.prizeLabel, category: w.category, ticketNumber: w.ticketNumber, displayName: w.displayName, status: w.status,
            ...(opts.admin ? { userId: w.userId ? String(w.userId) : null, statusNote: w.statusNote ?? null, statusAt: w.statusAt ?? null } : {}),
        })),
    }));
};

// ---------- Presentation ----------

/** A draw as shown: the seed only once drawn; the user ids only to the administration; winners only as revealed (public). */
const publicDraw = (d: IImpactTombolaDraw | Record<string, any>, opts: { admin?: boolean; withSeed?: boolean } = {}) => {
    const done = d.status === 'DONE';
    const shown = opts.admin ? d.winners : d.winners.slice(0, d.revealedCount ?? 0);
    return {
        _id: String(d._id), editionId: String(d.editionId), status: d.status,
        seedCommitment: d.seedCommitment, committedAt: d.committedAt, committedBeforeTicketsClosed: d.committedBeforeTicketsClosed,
        seed: done && (opts.withSeed || d.seed) ? d.seed ?? null : null,
        drawnAt: d.drawnAt ?? null, prizes: d.prizes,
        totalTickets: d.snapshot?.totalTickets ?? null, participants: d.snapshot?.participants ?? null,
        segmentsHash: d.snapshot?.segmentsHash ?? null,
        revealedCount: d.revealedCount ?? 0, winnersCount: d.winners?.length ?? 0,
        winners: (shown ?? []).map((w: TombolaWinner) => ({
            order: w.order, prizeKey: w.prizeKey, prizeLabel: w.prizeLabel, category: w.category, ticketNumber: w.ticketNumber,
            displayName: w.displayName, status: w.status,
            ...(opts.admin ? { userId: w.userId ? String(w.userId) : null, holderHash: w.holderHash, attempts: w.attempts, statusNote: w.statusNote ?? null, statusAt: w.statusAt ?? null } : {}),
        })),
    };
};

// ---------- Public and member ----------

const TTL_MS = 5_000;
let cache: { at: number; value: unknown } | null = null;
export const invalidateTombola = () => { cache = null; };

/** The current edition's tombola, as the live screen and members see it. Cached 5 s. */
export const publicTombola = async () => {
    if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
    const e = await currentEdition();
    let value: unknown = null;
    if (e && ![EditionStatus.DRAFT, EditionStatus.QUALIFICATION, EditionStatus.QUALIFICATION_CLOSED].includes(e.status)) {
        const d = await ImpactTombolaDraw.findOne({ editionId: e._id }).select('+seed').lean();
        const live = d?.status === 'DONE' ? null : await buildTickets(e, 'preview');
        value = {
            editionId: String(e._id), editionName: e.name,
            prizes: d?.status === 'DONE' ? d.prizes : settingsOf(e.settings).prizes.map((p) => ({ key: p.key, label: p.label, category: p.category })),
            tiers: settingsOf(e.settings).ticketTiers,
            cooldownDays: settingsOf(e.settings).prizeCooldownDays,
            totalTickets: d?.snapshot?.totalTickets ?? live?.totalTickets ?? 0,
            participants: d?.snapshot?.participants ?? live?.participants ?? 0,
            draw: d ? publicDraw(d) : null,
        };
    }
    cache = { at: Date.now(), value };
    return value;
};

/**
 * Everything needed to check a draw by hand (once done): the seed and its
 * commitment, the ticket segments with pseudonymous holders, the exclusions
 * per prize, the method, the winners.
 */
export const proof = async (drawId: string) => {
    const d = await ImpactTombolaDraw.findById(oid(drawId, 'Tirage')).select('+seed').lean();
    if (!d) throw new AppError('Tirage introuvable.', 404);
    if (d.status !== 'DONE') {
        return { drawId: String(d._id), status: d.status, seedCommitment: d.seedCommitment, committedAt: d.committedAt, committedBeforeTicketsClosed: d.committedBeforeTicketsClosed };
    }
    return {
        drawId: String(d._id), status: d.status,
        seedCommitment: d.seedCommitment, seed: d.seed, committedAt: d.committedAt, committedBeforeTicketsClosed: d.committedBeforeTicketsClosed,
        drawnAt: d.drawnAt, weightScale: d.weightScale,
        method: 'Pour chaque lot k dans l’ordre : on retire les détenteurs exclus (déjà gagnants de ce tirage, ou gagnants de la même catégorie de lot dans le délai) ; '
            + 'W = somme des (to − from + 1) × weight des tranches restantes ; x = les 6 premiers octets de HMAC-SHA256(seed en hexadécimal décodé, "<drawId>|<k>|<essai>") '
            + 'lus comme un entier, essai = 0, 1… jusqu’à x < ⌊2^48 / W⌋ × W ; r = x mod W ; on parcourt les tranches dans l’ordre des tickets en retirant leur poids : '
            + 'la tranche où r tombe contient le ticket from + ⌊r / weight⌋. Contrôle : sha256(seed) = seedCommitment, sha256(tranches) = segmentsHash.',
        segmentsHash: d.snapshot!.segmentsHash,
        segmentsFormat: 'une ligne par tranche : "<from>-<to>:<weight>:<holderHash>", lignes séparées par \\n',
        segments: d.snapshot!.segments.map((g) => ({ from: g.from, to: g.to, weight: g.weight, holderHash: g.holderHash })),
        exclusions: d.snapshot!.exclusions,
        prizes: d.prizes,
        winners: d.winners.map((w) => ({ order: w.order, prizeLabel: w.prizeLabel, ticketNumber: w.ticketNumber, holderHash: w.holderHash, attempts: w.attempts })),
    };
};

/** The member's tickets in the current edition: count, numbers, share of the chances, wins. */
export const myTickets = async (userId: string) => {
    const e = await currentEdition();
    if (!e) return null;
    const d = await ImpactTombolaDraw.findOne({ editionId: e._id }).lean();
    const t = d?.status === 'DONE' && d.snapshot ? { ...d.snapshot } : await buildTickets(e, 'preview');
    const mine = t.segments.filter((g) => String(g.userId) === userId);
    const tickets = mine.reduce((s, g) => s + g.to - g.from + 1, 0);
    const weight = mine.reduce((s, g) => s + (g.to - g.from + 1) * g.weight, 0);
    // Merge adjacent runs for display (weights differ inside a run of numbers).
    const ranges: { from: number; to: number }[] = [];
    for (const g of mine) {
        const last = ranges[ranges.length - 1];
        if (last && last.to === g.from - 1) last.to = g.to; else ranges.push({ from: g.from, to: g.to });
    }
    const revealed = d?.status === 'DONE' ? d.winners.slice(0, d.revealedCount) : [];
    return {
        editionId: String(e._id),
        tickets, ranges,
        sharePct: t.totalWeight ? Math.round((weight / t.totalWeight) * 10000) / 100 : 0,
        totalTickets: t.totalTickets,
        drawn: d?.status === 'DONE',
        wins: revealed.filter((w) => w.userId && String(w.userId) === userId).map((w) => ({ prizeLabel: w.prizeLabel, ticketNumber: w.ticketNumber, status: w.status })),
    };
};
