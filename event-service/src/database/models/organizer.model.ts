import mongoose, { Document, Schema, Types } from 'mongoose';

export enum OrganizerStatus {
    PENDING = 'PENDING',
    APPROVED = 'APPROVED',
    SUSPENDED = 'SUSPENDED',
}

export interface IOrganizer extends Document {
    _id: Types.ObjectId;
    userId: Types.ObjectId;
    displayName: string;
    contactEmail?: string;
    contactPhone?: string;
    bio?: string;
    logoFileId?: string;
    status: OrganizerStatus;
    approvedAt?: Date;
    suspendedAt?: Date;
    suspensionReason?: string;
    stats: {
        eventsPublished: number;
        ticketsSold: number;
        grossRevenue: number;
    };
    createdAt: Date;
    updatedAt: Date;
}

const OrganizerSchema = new Schema<IOrganizer>({
    userId: { type: Schema.Types.ObjectId, required: true, unique: true, index: true },
    displayName: { type: String, required: true, maxlength: 120 },
    contactEmail: { type: String, maxlength: 254 },
    contactPhone: { type: String, maxlength: 24 },
    bio: { type: String, maxlength: 2000 },
    logoFileId: { type: String },
    status: { type: String, enum: Object.values(OrganizerStatus), default: OrganizerStatus.PENDING, index: true },
    approvedAt: { type: Date },
    suspendedAt: { type: Date },
    suspensionReason: { type: String, maxlength: 500 },
    stats: {
        eventsPublished: { type: Number, default: 0 },
        ticketsSold: { type: Number, default: 0 },
        grossRevenue: { type: Number, default: 0 },
    },
}, { timestamps: true });

OrganizerSchema.index({ status: 1, createdAt: -1 });

export default mongoose.model<IOrganizer>('Organizer', OrganizerSchema);
