import { AuditLog, IAuditLog } from '../database/models/audit-log.model';
import { canonicalJson, sha256Hex, toPlainJson } from '../utils/crypto';
import { currentRequestId } from '../utils/request-context';
import logger from '../utils/logger';

const log = logger.getLogger('Audit');

export const GENESIS_HASH = '0'.repeat(64);

export interface AuditActor { type: IAuditLog['actor']['type']; id?: string | null; name?: string | null; roles?: string[] }

export interface AuditInput {
    actor: AuditActor;
    action: string;
    result?: 'ok' | 'denied' | 'error';
    target?: { type?: string; id?: string | null } | null;
    before?: unknown;
    after?: unknown;
    reason?: string | null;
    meta?: unknown;
    ip?: string | null;
    userAgent?: string | null;
}

/** The fields covered by an entry's hash (everything except `hash` and Mongo's `_id`). */
function hashedBody(e: Omit<IAuditLog, 'hash'>) {
    return {
        seq: e.seq, at: e.at, actor: e.actor, action: e.action, result: e.result, target: e.target ?? null,
        before: e.before ?? null, after: e.after ?? null, reason: e.reason ?? null, meta: e.meta ?? null,
        ip: e.ip ?? null, userAgent: e.userAgent ?? null, requestId: e.requestId ?? null, prevHash: e.prevHash,
    };
}

export const computeHash = (e: Omit<IAuditLog, 'hash'>): string => sha256Hex(`${e.prevHash}|${canonicalJson(hashedBody(e))}`);

// Appends from this process go one at a time; across processes the unique
// `seq` index makes a concurrent writer fail and retry on the new tail, so
// the chain stays linear.
let queue: Promise<unknown> = Promise.resolve();

export function audit(input: AuditInput): Promise<IAuditLog> {
    const run = () => appendWithRetry(input);
    const p = queue.then(run, run);
    queue = p.catch(() => undefined);
    return p;
}

/** Fire-and-forget variant for paths where an audit failure must not change the answer. */
export function auditSafe(input: AuditInput): void {
    audit(input).catch((err) => log.error('Audit append failed', { action: input.action, message: (err as Error).message }));
}

async function appendWithRetry(input: AuditInput): Promise<IAuditLog> {
    for (let attempt = 0; attempt < 20; attempt++) {
        const last = await AuditLog.findOne({}, { seq: 1, hash: 1 }).sort({ seq: -1 }).lean();
        const entry: Omit<IAuditLog, 'hash'> = {
            seq: (last?.seq ?? 0) + 1,
            at: new Date(),
            actor: toPlainJson({ type: input.actor.type, id: input.actor.id ?? null, name: input.actor.name ?? null, roles: input.actor.roles ?? [] }),
            action: input.action,
            result: input.result ?? 'ok',
            target: input.target ? toPlainJson({ type: input.target.type ?? null, id: input.target.id ?? null }) : null,
            before: input.before === undefined ? null : toPlainJson(input.before),
            after: input.after === undefined ? null : toPlainJson(input.after),
            reason: input.reason ?? null,
            meta: input.meta === undefined ? null : toPlainJson(input.meta),
            ip: input.ip ?? null,
            userAgent: input.userAgent ?? null,
            requestId: currentRequestId() ?? null,
            prevHash: last?.hash ?? GENESIS_HASH,
        };
        const hash = computeHash(entry);
        try {
            const [doc] = await AuditLog.insertMany([{ ...entry, hash }], { lean: true });
            return doc as unknown as IAuditLog;
        } catch (err: any) {
            if (err?.code === 11000) {
                await new Promise((r) => setTimeout(r, Math.random() * 20));
                continue;
            }
            throw err;
        }
    }
    throw new Error('Audit append: too much contention');
}

export interface VerifyResult { ok: boolean; count: number; firstBadSeq?: number; reason?: string }

/** Walks the whole chain: contiguous seq, prevHash links, recomputed hashes. */
export async function verifyAuditChain(): Promise<VerifyResult> {
    let prevHash = GENESIS_HASH;
    let expectedSeq = 1;
    let count = 0;
    const cursor = AuditLog.find({}).sort({ seq: 1 }).lean().cursor();
    for await (const doc of cursor) {
        const e = doc as unknown as IAuditLog;
        if (e.seq !== expectedSeq) return { ok: false, count, firstBadSeq: expectedSeq, reason: `missing or extra entry (found seq ${e.seq})` };
        if (e.prevHash !== prevHash) return { ok: false, count, firstBadSeq: e.seq, reason: 'prevHash does not match the previous entry' };
        const recomputed = computeHash({ ...e, at: new Date(e.at) });
        if (recomputed !== e.hash) return { ok: false, count, firstBadSeq: e.seq, reason: 'content does not match its hash' };
        prevHash = e.hash;
        expectedSeq++;
        count++;
    }
    return { ok: true, count };
}
