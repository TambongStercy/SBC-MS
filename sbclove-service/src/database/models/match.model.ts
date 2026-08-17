import mongoose, { Schema, Document, Types } from 'mongoose';
import { ContactChoice } from '../../types/sbclove.enums';

// Per-participant contact choice within a match (spec §12-13, double opt-in).
export interface IMatchParticipant {
    userId: Types.ObjectId;
    choice: ContactChoice;
    choiceUpdatedAt?: Date;
}

// A Match is created when interest is reciprocal (spec §10).
// userA/userB are stored in a canonical (sorted) order so the pair is unique.
export interface IMatch extends Document {
    _id: Types.ObjectId;
    userA: Types.ObjectId;
    userB: Types.ObjectId;
    participants: IMatchParticipant[];
    contactUnlocked: boolean; // true once both participants chose WANTS_CONTACT
    contactUnlockedAt?: Date;
    createdAt: Date;
    updatedAt: Date;
}

const MatchParticipantSchema = new Schema<IMatchParticipant>(
    {
        userId: { type: Schema.Types.ObjectId, required: true },
        choice: {
            type: String,
            enum: Object.values(ContactChoice),
            required: true,
            default: ContactChoice.PENDING,
        },
        choiceUpdatedAt: { type: Date },
    },
    { _id: false }
);

const MatchSchema = new Schema<IMatch>(
    {
        userA: { type: Schema.Types.ObjectId, required: true, index: true },
        userB: { type: Schema.Types.ObjectId, required: true, index: true },
        participants: { type: [MatchParticipantSchema], required: true },
        contactUnlocked: { type: Boolean, required: true, default: false },
        contactUnlockedAt: { type: Date },
    },
    {
        timestamps: true,
    }
);

// Unique match per canonical pair.
MatchSchema.index({ userA: 1, userB: 1 }, { unique: true });

const MatchModel = mongoose.model<IMatch>('Match', MatchSchema);

export default MatchModel;
