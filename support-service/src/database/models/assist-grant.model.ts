import { Schema, model, Types } from 'mongoose';

/**
 * Live assistance (2026-11-23): the desk let one agent near one member's live screen.
 * « Regarder » (`replay.read`) opens a watch-only grant; « Assistance en direct »
 * (`assist.control`) one that may also ask for remote control. While it is open, that agent
 * (matched by their OpenReplay account e-mail, the same as their desk e-mail) may ASK the
 * member; the member app checks the grant before showing each prompt, and the member must
 * still accept. No grant, no prompt: an OpenReplay user acting outside the desk is declined.
 */
export interface IAssistGrant {
    memberId: string;
    agentId: string;
    agentName: string;
    agentEmail: string;
    ticketId: Types.ObjectId | null;
    /** false = watch only (« Regarder »), true = may also ask for remote control (« Assistance en direct »). */
    control: boolean;
    startedAt: Date;
    expiresAt: Date;
    endedAt: Date | null;
    endedBy: 'agent' | 'expired' | null;
}

const schema = new Schema<IAssistGrant>({
    memberId: { type: String, required: true },
    agentId: { type: String, required: true },
    agentName: { type: String, required: true },
    agentEmail: { type: String, required: true, lowercase: true, trim: true },
    ticketId: { type: Schema.Types.ObjectId, default: null },
    control: { type: Boolean, required: true, default: false },
    startedAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
    endedAt: { type: Date, default: null },
    endedBy: { type: String, default: null },
}, { timestamps: true });

schema.index({ memberId: 1, agentEmail: 1, expiresAt: -1 });
schema.index({ agentId: 1, startedAt: -1 });

export const AssistGrant = model<IAssistGrant>('AssistGrant', schema, 'assistgrants');
