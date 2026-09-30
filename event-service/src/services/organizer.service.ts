import { Types } from 'mongoose';
import Organizer, { IOrganizer, OrganizerStatus } from '../database/models/organizer.model';
import { AppError } from '../utils/errors';

export const findMyOrganizer = async (userId: string): Promise<IOrganizer | null> => {
    return Organizer.findOne({ userId: new Types.ObjectId(userId) }).exec();
};

export const findApprovedOrganizer = async (userId: string): Promise<IOrganizer | null> => {
    return Organizer.findOne({
        userId: new Types.ObjectId(userId),
        status: OrganizerStatus.APPROVED,
    }).exec();
};

export const applyAsOrganizer = async (userId: string, payload: {
    displayName: string;
    contactEmail?: string;
    contactPhone?: string;
    bio?: string;
    logoFileId?: string;
}): Promise<IOrganizer> => {
    const existing = await Organizer.findOne({ userId: new Types.ObjectId(userId) });
    if (existing) throw new AppError('Vous avez déjà une candidature organisateur.', 409);
    if (!payload.displayName?.trim()) throw new AppError('Le nom affiché est obligatoire.', 400);

    return Organizer.create({
        userId: new Types.ObjectId(userId),
        displayName: payload.displayName.trim(),
        contactEmail: payload.contactEmail?.trim(),
        contactPhone: payload.contactPhone?.trim(),
        bio: payload.bio?.trim(),
        logoFileId: payload.logoFileId,
        status: OrganizerStatus.PENDING,
    });
};

export const listOrganizers = async (params: {
    status?: OrganizerStatus;
    limit?: number;
    skip?: number;
}) => {
    const filter: any = {};
    if (params.status) filter.status = params.status;
    const [items, total] = await Promise.all([
        Organizer.find(filter).sort({ createdAt: -1 }).limit(params.limit ?? 50).skip(params.skip ?? 0).lean(),
        Organizer.countDocuments(filter),
    ]);
    return { items, total };
};

export const approveOrganizer = async (organizerId: string): Promise<IOrganizer> => {
    const org = await Organizer.findByIdAndUpdate(
        organizerId,
        { $set: { status: OrganizerStatus.APPROVED, approvedAt: new Date() } },
        { new: true },
    );
    if (!org) throw new AppError('Organisateur introuvable.', 404);
    return org;
};

export const suspendOrganizer = async (organizerId: string, reason?: string): Promise<IOrganizer> => {
    const org = await Organizer.findByIdAndUpdate(
        organizerId,
        { $set: { status: OrganizerStatus.SUSPENDED, suspendedAt: new Date(), suspensionReason: reason } },
        { new: true },
    );
    if (!org) throw new AppError('Organisateur introuvable.', 404);
    return org;
};
