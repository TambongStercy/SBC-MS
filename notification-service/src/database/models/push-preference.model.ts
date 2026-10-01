import mongoose, { Document, Schema, Types } from 'mongoose';

/** Which kinds of push a user turned off. Absent = everything on. */
export interface IPushPreference extends Document {
    userId: Types.ObjectId;
    disabled: string[];
}

const PushPreferenceSchema = new Schema<IPushPreference>(
    {
        userId: { type: Schema.Types.ObjectId, required: true, unique: true },
        disabled: { type: [String], default: [] },
    },
    { timestamps: true },
);

export default mongoose.model<IPushPreference>('PushPreference', PushPreferenceSchema);
