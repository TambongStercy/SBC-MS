import { Schema, model } from 'mongoose';

export interface ISetting { key: string; value: unknown; updatedBy?: string | null; updatedAt?: Date }

const SettingSchema = new Schema<ISetting>({
    key: { type: String, required: true, unique: true },
    value: { type: Schema.Types.Mixed },
    updatedBy: { type: String, default: null },
}, { timestamps: true, minimize: false });

export const Setting = model<ISetting>('Setting', SettingSchema, 'settings');
