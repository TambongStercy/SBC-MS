import { AppError } from '../../../utils/errors';
import { AnimChallenge } from '../models/challenge.model';
import { AnimVotePackage } from '../models/vote.model';
import { AnimCtx, ChallengeStatus, allowsPaidVotes, statusIndex } from '../types';
import { audit } from '../lib/audit';

/**
 * Vote packs (§17). Prices are part of what people compete under: once the
 * challenge is ACTIVE a pack can no longer be created or edited, only
 * archived (which stops its sale) (§38).
 */
const shape = (body: Record<string, any>) => {
    const label = String(body.label ?? '').trim().slice(0, 60);
    const votes = Number(body.votes);
    const price = Number(body.price);
    if (!label) throw new AppError('Donnez un nom au pack.', 400);
    if (!Number.isInteger(votes) || votes < 1 || votes > 100000) throw new AppError('Nombre de votes invalide.', 400);
    if (!Number.isInteger(price) || price < 100) throw new AppError('Prix minimum : 100 XAF.', 400);
    const availableFrom = body.availableFrom ? new Date(body.availableFrom) : undefined;
    const availableUntil = body.availableUntil ? new Date(body.availableUntil) : undefined;
    if (availableFrom && availableUntil && availableFrom >= availableUntil) throw new AppError('Disponibilité invalide.', 400);
    return { label, votes, price, availableFrom, availableUntil, sortOrder: Number(body.sortOrder) || 0 };
};

const editableChallenge = async (ctx: AnimCtx, challengeId: string) => {
    const c = await AnimChallenge.findOne({ _id: challengeId, eventId: ctx.eventId });
    if (!c) throw new AppError('Défi introuvable.', 404);
    if (!allowsPaidVotes(c.voting.mode)) throw new AppError('Ce défi n’a pas de votes payants.', 409);
    if (statusIndex(c.status) >= statusIndex(ChallengeStatus.ACTIVE) || c.status === ChallengeStatus.CANCELLED) {
        throw new AppError('Les packs sont verrouillés depuis le lancement du défi.', 409, true, 'LOCKED_FIELDS', { fields: ['packages'] });
    }
    return c;
};

export const listPackages = (challengeId: string, onlyActive = false) =>
    AnimVotePackage.find({ challengeId, ...(onlyActive ? { status: 'ACTIVE' } : {}) }).sort({ sortOrder: 1, price: 1 }).lean();

export const createPackage = async (ctx: AnimCtx, challengeId: string, body: Record<string, any>) => {
    const c = await editableChallenge(ctx, challengeId);
    const input = shape(body);
    const pack = await AnimVotePackage.create({ ...input, organizerId: ctx.organizerId, eventId: ctx.eventId, challengeId: c._id });
    await audit({ actor: ctx, action: 'package.create', targetType: 'vote_package', targetId: pack._id, challengeId: c._id, after: input });
    return pack;
};

export const updatePackage = async (ctx: AnimCtx, packageId: string, body: Record<string, any>) => {
    const pack = await AnimVotePackage.findOne({ _id: packageId, eventId: ctx.eventId });
    if (!pack) throw new AppError('Pack introuvable.', 404);
    await editableChallenge(ctx, String(pack.challengeId));
    const input = shape({ ...pack.toObject(), ...body });
    const before = { label: pack.label, votes: pack.votes, price: pack.price };
    Object.assign(pack, input);
    await pack.save();
    await audit({ actor: ctx, action: 'package.update', targetType: 'vote_package', targetId: pack._id, challengeId: pack.challengeId, before, after: input });
    return pack;
};

export const archivePackage = async (ctx: AnimCtx, packageId: string) => {
    const pack = await AnimVotePackage.findOneAndUpdate({ _id: packageId, eventId: ctx.eventId }, { $set: { status: 'ARCHIVED' } }, { new: true });
    if (!pack) throw new AppError('Pack introuvable.', 404);
    await audit({ actor: ctx, action: 'package.archive', targetType: 'vote_package', targetId: pack._id, challengeId: pack.challengeId });
    return pack;
};
