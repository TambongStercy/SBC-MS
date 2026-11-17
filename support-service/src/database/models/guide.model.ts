import { Schema, model } from 'mongoose';

/** The guided-paths tree shown to members (one document; code default until edited). */
export interface IGuideTree { key: string; nodes: unknown[]; updatedBy?: string | null; updatedAt?: Date }

const GuideTreeSchema = new Schema<IGuideTree>({
    key: { type: String, required: true, unique: true },
    nodes: { type: [Schema.Types.Mixed], default: [] },
    updatedBy: { type: String, default: null },
}, { timestamps: true, minimize: false });

export const GuideTree = model<IGuideTree>('GuideTree', GuideTreeSchema, 'guides');
