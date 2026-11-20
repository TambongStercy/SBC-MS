import cron from 'node-cron';
import mongoose from 'mongoose';
import logger from '../utils/logger';
import PaymentIntentModel from '../database/models/PaymentIntent';
import { PaymentStatus } from '../database/interfaces/IPaymentIntent';

const log = logger.getLogger('PayinArchive');

/**
 * Security plan Phase 10, item 7: abandoned payments (page opened or not, no
 * provider ever chosen) are moved out of `paymentintents` after 7 days, so the
 * collection every payment query reads stays small. The plan said "deleted";
 * Sterling: never delete anything, so they are MOVED to
 * `paymentintents_archive`, whole and unchanged, and still counted in the
 * conversion figures (payment-conversion.service reads both).
 *
 * Order per batch: copy to the archive (same _id, so a re-run never duplicates),
 * then remove from paymentintents only the ids that are in the archive AND
 * still abandoned. A payment a member picked up in between stays where it is,
 * and its archive copy is removed (the original is still there).
 *
 * Off unless PAYIN_ARCHIVE_ENABLED=true. Daily at 04:10 Douala. Dry run and
 * one-off runs: src/scripts/archive-abandoned-payins.ts.
 */
export const ARCHIVE_COLLECTION = 'paymentintents_archive';
const DAY = 24 * 3600_000;
const AFTER_DAYS = Number(process.env.PAYIN_ARCHIVE_AFTER_DAYS || 7);
const BATCH = 1000;
const MAX_PER_RUN = Number(process.env.PAYIN_ARCHIVE_MAX_PER_RUN || 100_000);

export const archiveCollection = () => mongoose.connection.collection(ARCHIVE_COLLECTION);

/** What counts as abandoned: still waiting for the member, no provider, older than the cut-off. */
export const abandonedFilter = (cutoff: Date) => ({
    status: PaymentStatus.PENDING_USER_INPUT,
    gateway: { $in: [null, 'none'] },
    createdAt: { $lt: cutoff },
});

export async function ensureArchiveIndexes() {
    await archiveCollection().createIndex({ createdAt: -1 });
    await archiveCollection().createIndex({ sessionId: 1 });
}

export interface ArchiveResult { candidates: number; copied: number; moved: number; keptBack: number; dryRun: boolean }

export async function archiveAbandoned(opts: { now?: Date; dryRun?: boolean; max?: number } = {}): Promise<ArchiveResult> {
    const now = opts.now ?? new Date();
    const cutoff = new Date(now.getTime() - AFTER_DAYS * DAY);
    const filter = abandonedFilter(cutoff);
    const max = opts.max ?? MAX_PER_RUN;
    const candidates = await PaymentIntentModel.countDocuments(filter);
    const result: ArchiveResult = { candidates, copied: 0, moved: 0, keptBack: 0, dryRun: !!opts.dryRun };
    if (opts.dryRun || candidates === 0) return result;

    await ensureArchiveIndexes();
    const raw = PaymentIntentModel.collection;
    while (result.moved + result.keptBack < max) {
        const docs = await raw.find(filter).sort({ createdAt: 1 }).limit(BATCH).toArray();
        if (!docs.length) break;
        const ids = docs.map(d => d._id);

        // 1. Copy (idempotent: same _id, upsert).
        const ops = docs.map(d => ({ replaceOne: { filter: { _id: d._id }, replacement: { ...d, archivedAt: now }, upsert: true } }));
        await archiveCollection().bulkWrite(ops, { ordered: false });
        result.copied += docs.length;

        // 2. Remove from the live collection only what is safely in the archive and still abandoned.
        const inArchive = (await archiveCollection().find({ _id: { $in: ids } }, { projection: { _id: 1 } }).toArray()).map(d => d._id);
        const del = await raw.deleteMany({ _id: { $in: inArchive }, ...filter });
        result.moved += del.deletedCount || 0;

        // 3. Picked up in between: the original stays live; drop its archive copy.
        const still = (await raw.find({ _id: { $in: inArchive } }, { projection: { _id: 1 } }).toArray()).map(d => d._id);
        if (still.length) {
            await archiveCollection().deleteMany({ _id: { $in: still } });
            result.keptBack += still.length;
        }
        if (docs.length < BATCH) break;
    }
    return result;
}

class PayinArchiveJob {
    private task: ReturnType<typeof cron.schedule> | null = null;
    private running = false;

    start() {
        if (process.env.PAYIN_ARCHIVE_ENABLED !== 'true') {
            log.info('Abandoned-payment archive off (PAYIN_ARCHIVE_ENABLED is not true).');
            return;
        }
        this.task = cron.schedule('10 4 * * *', async () => {
            if (this.running) return;
            this.running = true;
            try {
                const r = await archiveAbandoned();
                log.info(`Abandoned payments archived: ${r.moved} moved, ${r.keptBack} picked up meanwhile, ${r.candidates} were eligible.`);
            } catch (e: any) {
                log.error(`Abandoned-payment archive failed: ${e?.message}`);
            } finally {
                this.running = false;
            }
        }, { timezone: 'Africa/Douala' });
        log.info('Abandoned-payment archive scheduled daily at 04:10 Douala.');
    }

    stop() {
        this.task?.stop();
    }
}

export const payinArchiveJob = new PayinArchiveJob();
