import { Schema, model } from 'mongoose';

/** Atomic sequences (ticket numbers). */
const CounterSchema = new Schema<{ _id: string; seq: number }>({ _id: String, seq: { type: Number, default: 0 } }, { versionKey: false });
export const Counter = model<{ _id: string; seq: number }>('Counter', CounterSchema, 'counters');

export async function nextSeq(name: string): Promise<number> {
    const doc = await Counter.findOneAndUpdate({ _id: name }, { $inc: { seq: 1 } }, { new: true, upsert: true });
    return doc!.seq;
}
