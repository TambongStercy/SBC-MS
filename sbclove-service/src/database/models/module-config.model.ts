import mongoose, { Schema, Document } from 'mongoose';

// Singleton document holding the runtime-tunable SBCLOVE module settings
// (spec §2, §9, §14). Defaults are seeded from env config on first read.
// `enabled` is the global kill-switch the admin can toggle (spec §14).
export interface IModuleConfig extends Document {
    key: string;              // always 'singleton'
    enabled: boolean;
    activeWeekday: number;    // 0=Sunday ... 6=Saturday
    openHour: number;
    closeHour: number;
    timezone: string;
    maxInterestsPerWeek: number;
    autoSuspendThreshold: number;
    autoApprove: boolean;       // auto-approve profiles passing content validation (spec §7)
    updatedBy?: string;
    createdAt: Date;
    updatedAt: Date;
}

const ModuleConfigSchema = new Schema<IModuleConfig>(
    {
        key: { type: String, required: true, unique: true, default: 'singleton' },
        enabled: { type: Boolean, required: true, default: true },
        activeWeekday: { type: Number, required: true, default: 3 },
        openHour: { type: Number, required: true, default: 18 },
        closeHour: { type: Number, required: true, default: 21 },
        timezone: { type: String, required: true, default: 'Africa/Douala' },
        maxInterestsPerWeek: { type: Number, required: true, default: 5 },
        autoSuspendThreshold: { type: Number, required: true, default: 3 },
        autoApprove: { type: Boolean, required: true, default: false },
        updatedBy: { type: String },
    },
    {
        timestamps: true,
    }
);

const ModuleConfigModel = mongoose.model<IModuleConfig>('ModuleConfig', ModuleConfigSchema);

export default ModuleConfigModel;
