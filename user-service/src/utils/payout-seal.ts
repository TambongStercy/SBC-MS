/**
 * Payout seal (2026-11-22, asked by Sterling after the Phase 0 MoMo lock): where a member's money can
 * go — MoMo number + operator, crypto wallet + network — is sealed with an HMAC keyed by
 * PAYOUT_SEAL_KEY, which lives only in this service's .env, never in the database.
 *
 * Every write that goes through this code (member flows with the authenticator code, admin edit,
 * support change, scripts) reseals automatically: this plugin hooks every save/update of the User
 * model that touches those fields. A change made directly in the database (mongosh, Compass, a
 * stolen DB password) cannot produce a valid seal, so it is caught (services/payout-seal.service.ts):
 * before every withdrawal and admin approval, and by a nightly sweep.
 *
 * Before an update touching the fields, the documents' current seals are checked first: a doc whose
 * seal is already broken is NOT resealed (an unrelated legit write must not launder an earlier
 * tamper); it is reported instead.
 */
import crypto from 'crypto';
import mongoose, { Schema } from 'mongoose';

export const PAYOUT_FIELDS = ['momoNumber', 'momoOperator', 'cryptoWalletAddress', 'cryptoWalletCurrency'] as const;
export type PayoutFields = Partial<Record<typeof PAYOUT_FIELDS[number], string | null>>;
export interface PayoutSeal { v: 1; h: string; at: Date; tails: { momo: string | null; crypto: string | null } }

const key = () => {
    const k = process.env.PAYOUT_SEAL_KEY || '';
    return k.length >= 32 ? k : null;
};
export const sealEnabled = () => key() !== null;
/** Set once every member has a seal (bootstrap script): from then on, a missing seal is a tamper too. */
export const sealSince = (): Date | null => {
    const s = process.env.PAYOUT_SEAL_SINCE;
    const d = s ? new Date(s) : null;
    return d && !Number.isNaN(d.getTime()) ? d : null;
};

const norm = (v: unknown) => (v === undefined || v === null ? '' : String(v).trim());
const tail = (v: unknown, n: number) => (norm(v) ? `…${norm(v).slice(-n)}` : null);

export function sealHash(userId: unknown, f: PayoutFields): string {
    const k = key();
    if (!k) throw new Error('PAYOUT_SEAL_KEY missing');
    const body = ['v1', String(userId), ...PAYOUT_FIELDS.map((x) => norm(f[x]))].join('|');
    return crypto.createHmac('sha256', k).update(body).digest('hex');
}

export function makeSeal(userId: unknown, f: PayoutFields): PayoutSeal {
    return { v: 1, h: sealHash(userId, f), at: new Date(), tails: { momo: tail(f.momoNumber, 3), crypto: tail(f.cryptoWalletAddress, 4) } };
}

export type SealState = 'ok' | 'missing' | 'mismatch' | 'off';
export function sealState(doc: PayoutFields & { _id: unknown; payoutSeal?: { h?: string } | null }): SealState {
    if (!sealEnabled()) return 'off';
    if (!doc.payoutSeal?.h) return sealSince() ? 'missing' : 'off';
    const want = sealHash(doc._id, doc);
    const got = String(doc.payoutSeal.h);
    return want.length === got.length && crypto.timingSafeEqual(Buffer.from(want), Buffer.from(got)) ? 'ok' : 'mismatch';
}

/** Docs whose seal was found broken by a hook, for the service to handle (registered by it at start). */
type TamperHandler = (userId: string, state: SealState, where: string) => void;
let onTamper: TamperHandler = () => undefined;
export function setTamperHandler(h: TamperHandler) { onTamper = h; }

const PROJ = Object.fromEntries([...PAYOUT_FIELDS, 'payoutSeal'].map((f) => [f, 1]));
const touches = (update: any): boolean => {
    if (!update || typeof update !== 'object') return false;
    const keys = new Set<string>();
    for (const [k, v] of Object.entries(update)) {
        if (k.startsWith('$') && v && typeof v === 'object') Object.keys(v as object).forEach((x) => keys.add(x.split('.')[0]));
        else keys.add(k.split('.')[0]);
    }
    return PAYOUT_FIELDS.some((f) => keys.has(f));
};

async function reseal(coll: any, ids: unknown[]) {
    for (const id of ids) {
        const d = await coll.findOne({ _id: id }, { projection: PROJ });
        if (!d) continue;
        // Compare-and-set on the values just read: a concurrent change is never sealed blind.
        const cond: any = { _id: id };
        for (const f of PAYOUT_FIELDS) cond[f] = d[f] ?? null;
        await coll.updateOne(cond, { $set: { payoutSeal: makeSeal(id, d) } });
    }
}

/** Mongoose plugin for the User schema. A no-op while PAYOUT_SEAL_KEY is unset. */
export function payoutSealPlugin(schema: Schema) {
    const QUERY_OPS = ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne'] as const;
    for (const op of QUERY_OPS) {
        schema.pre(op as any, async function (this: any) {
            if (!sealEnabled() || !touches(this.getUpdate())) return;
            const coll = this.model.collection;
            const docs = await coll.find(this.getQuery(), { projection: PROJ }).limit(500).toArray();
            const ok: unknown[] = [];
            for (const d of docs) {
                const st = sealState(d);
                if (st === 'mismatch' || st === 'missing') onTamper(String(d._id), st, `before ${op}`);
                else ok.push(d._id);
            }
            this._payoutSealIds = ok;
        });
        schema.post(op as any, async function (this: any) {
            const ids = this._payoutSealIds as unknown[] | undefined;
            if (ids?.length) await reseal(this.model.collection, ids);
        });
    }
    schema.pre('save', async function (this: any) {
        if (!sealEnabled()) return;
        if (this.isNew) { this.$locals.payoutSealNew = true; return; }
        if (!PAYOUT_FIELDS.some((f) => this.isModified(f))) return;
        const d = await (this.constructor as any).collection.findOne({ _id: this._id }, { projection: PROJ });
        const st = d ? sealState(d) : 'ok';
        if (st === 'mismatch' || st === 'missing') { onTamper(String(this._id), st, 'before save'); return; }
        this.$locals.payoutSealResave = true;
    });
    schema.post('save', async function (this: any) {
        if (this.$locals?.payoutSealNew || this.$locals?.payoutSealResave) await reseal((this.constructor as any).collection, [this._id]);
    });
    // insertMany skips save hooks: seal right after.
    schema.post('insertMany', async function (this: any, docs: any[]) {
        if (sealEnabled() && docs?.length) await reseal(this.collection ?? mongoose.connection.collection('users'), docs.map((d) => d._id));
    });
}
