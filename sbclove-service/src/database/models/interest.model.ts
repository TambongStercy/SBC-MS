import mongoose, { Schema, Document, Types } from 'mongoose';

// An expression of interest from one user toward another (spec §9).
// "sessionDate" is the date-key (YYYY-MM-DD) of the weekly session, used as the
// bucket for the "max N interests per week" quota so it resets each Wednesday.
export interface IInterest extends Document {
    _id: Types.ObjectId;
    fromUserId: Types.ObjectId;
    toUserId: Types.ObjectId;
    sessionDate: string;   // YYYY-MM-DD (active weekday of the week it was sent)
    createdAt: Date;
    updatedAt: Date;
}

const InterestSchema = new Schema<IInterest>(
    {
        fromUserId: {
            type: Schema.Types.ObjectId,
            required: true,
            index: true,
        },
        toUserId: {
            type: Schema.Types.ObjectId,
            required: true,
            index: true,
        },
        sessionDate: {
            type: String,
            required: true,
            index: true,
        },
    },
    {
        timestamps: true,
    }
);

// A user may express interest in a given target only once (idempotent).
InterestSchema.index({ fromUserId: 1, toUserId: 1 }, { unique: true });

// Fast quota counting: interests by a user within a session.
InterestSchema.index({ fromUserId: 1, sessionDate: 1 });

const InterestModel = mongoose.model<IInterest>('Interest', InterestSchema);

export default InterestModel;
