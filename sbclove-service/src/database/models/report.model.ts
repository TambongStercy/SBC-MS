import mongoose, { Schema, Document, Types } from 'mongoose';
import { ReportStatus } from '../../types/sbclove.enums';

// A report filed against a profile (spec §14).
export interface IReport extends Document {
    _id: Types.ObjectId;
    reporterId: Types.ObjectId;
    reportedUserId: Types.ObjectId;   // owner of the reported profile
    reportedProfileId: Types.ObjectId;
    reason: string;
    status: ReportStatus;
    reviewedBy?: Types.ObjectId;
    reviewedAt?: Date;
    createdAt: Date;
    updatedAt: Date;
}

const ReportSchema = new Schema<IReport>(
    {
        reporterId: { type: Schema.Types.ObjectId, required: true, index: true },
        reportedUserId: { type: Schema.Types.ObjectId, required: true, index: true },
        reportedProfileId: { type: Schema.Types.ObjectId, ref: 'LoveProfile', required: true, index: true },
        reason: { type: String, required: true, trim: true },
        status: {
            type: String,
            enum: Object.values(ReportStatus),
            required: true,
            default: ReportStatus.OPEN,
            index: true,
        },
        reviewedBy: { type: Schema.Types.ObjectId },
        reviewedAt: { type: Date },
    },
    {
        timestamps: true,
    }
);

// A user can report a given profile only once (distinct-report counting).
ReportSchema.index({ reporterId: 1, reportedProfileId: 1 }, { unique: true });

const ReportModel = mongoose.model<IReport>('Report', ReportSchema);

export default ReportModel;
