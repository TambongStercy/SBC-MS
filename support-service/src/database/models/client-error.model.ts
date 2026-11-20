import { Schema, model, Types } from 'mongoose';

/**
 * Technical errors members' apps hit (failed API calls), reported by the member app.
 * One « type » per call + status (+ error code), counted per day, with the members
 * it touched, so the analytics page can show volume, recurrence and who is affected,
 * and the support administrator can mark a type as being handled or fixed.
 */
export const CLIENT_ERROR_STATES = ['open', 'handling', 'resolved'] as const;
export type ClientErrorState = typeof CLIENT_ERROR_STATES[number];

export interface IClientErrorType {
    signature: string;
    method: string;
    route: string;
    status: number;
    code?: string | null;
    lastMessage?: string | null;
    firstSeen: Date;
    lastSeen: Date;
    total: number;
    state: ClientErrorState;
    stateAt?: Date | null;
    stateBy?: { id: string; name: string } | null;
    note?: string | null;
    regressions: number;
    lastRegressionAt?: Date | null;
    lastReplay?: { sessionId: string; url: string; at: Date } | null;
}

const ClientErrorTypeSchema = new Schema<IClientErrorType>({
    signature: { type: String, required: true, unique: true },
    method: { type: String, required: true },
    route: { type: String, required: true },
    status: { type: Number, required: true },
    code: { type: String, default: null },
    lastMessage: { type: String, default: null },
    firstSeen: { type: Date, required: true },
    lastSeen: { type: Date, required: true, index: true },
    total: { type: Number, default: 0 },
    state: { type: String, enum: CLIENT_ERROR_STATES as unknown as string[], default: 'open', index: true },
    stateAt: { type: Date, default: null },
    stateBy: { type: new Schema({ id: String, name: String }, { _id: false }), default: null },
    note: { type: String, default: null },
    regressions: { type: Number, default: 0 },
    lastRegressionAt: { type: Date, default: null },
    lastReplay: { type: new Schema({ sessionId: String, url: String, at: Date }, { _id: false }), default: null },
});

/** Occurrences per type and day (Douala time), kept 400 days. */
export interface IClientErrorDay { typeId: Types.ObjectId; day: string; count: number; createdAt: Date }
const ClientErrorDaySchema = new Schema<IClientErrorDay>({
    typeId: { type: Schema.Types.ObjectId, required: true },
    day: { type: String, required: true },
    count: { type: Number, default: 0 },
    createdAt: { type: Date, default: () => new Date(), expires: 400 * 24 * 3600 },
});
ClientErrorDaySchema.index({ typeId: 1, day: 1 }, { unique: true });
ClientErrorDaySchema.index({ day: 1 });

/** Which members hit a type on a day (distinct counts), kept 400 days. */
export interface IClientErrorMember { typeId: Types.ObjectId; day: string; memberId: string; createdAt: Date }
const ClientErrorMemberSchema = new Schema<IClientErrorMember>({
    typeId: { type: Schema.Types.ObjectId, required: true },
    day: { type: String, required: true },
    memberId: { type: String, required: true },
    createdAt: { type: Date, default: () => new Date(), expires: 400 * 24 * 3600 },
});
ClientErrorMemberSchema.index({ typeId: 1, day: 1, memberId: 1 }, { unique: true });
ClientErrorMemberSchema.index({ day: 1 });

export const ClientErrorType = model<IClientErrorType>('ClientErrorType', ClientErrorTypeSchema, 'clienterrortypes');
export const ClientErrorDay = model<IClientErrorDay>('ClientErrorDay', ClientErrorDaySchema, 'clienterrordays');
export const ClientErrorMember = model<IClientErrorMember>('ClientErrorMember', ClientErrorMemberSchema, 'clienterrormembers');
