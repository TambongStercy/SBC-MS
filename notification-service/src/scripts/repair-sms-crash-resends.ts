/**
 * Cleans up after the numeric-phone crash (2026-10-08 → 10-10).
 *
 * The SMS step threw after each email had gone out and before the target was
 * saved, so the day was never recorded: every run resent the same email and
 * took a credit. Each crash in the logs is one email that really went out.
 *
 * For every target listed (target id + crash count, from the logs):
 *  - records the current day as delivered, so the sender advances it on its
 *    next run WITHOUT sending another copy (its "already sent" check);
 *  - gives the parrain back count - 1 email credits (the first send of that
 *    day was the legitimate one).
 * A marker on the recorded delivery makes a second --apply a no-op.
 *
 *   npx ts-node src/scripts/repair-sms-crash-resends.ts stuck-targets.txt          # dry run
 *   npx ts-node src/scripts/repair-sms-crash-resends.ts stuck-targets.txt --apply
 *
 * File format: one "<targetId> <crashCount>" per line.
 */
import fs from 'fs';
import mongoose from 'mongoose';
import config from '../config';
import RelanceTargetModel, { TargetStatus } from '../database/models/relance-target.model';
import RelanceConfigModel from '../database/models/relance-config.model';

const APPLY = process.argv.includes('--apply');
const FILE = process.argv.slice(2).find(a => !a.startsWith('--'));
export const REPAIR_MARKER = 'repair:numeric-phone-crash-2026-10-10';

export async function repairSmsCrashResends(entries: Array<{ id: string; count: number }>, apply: boolean, now = new Date()) {
    const refunds = new Map<string, number>();
    const report: string[] = [];
    let repaired = 0;

    for (const { id, count } of entries) {
        const t: any = await RelanceTargetModel.findById(id);
        if (!t) { report.push(`${id}: not found, skipped`); continue; }
        if (t.messagesDelivered.some((m: any) => m.errorMessage === REPAIR_MARKER)) {
            report.push(`${id}: already repaired, skipped`);
            continue;
        }
        if (t.status !== TargetStatus.ACTIVE) {
            report.push(`${id}: status ${t.status}, skipped`);
            continue;
        }
        const alreadyRecorded = t.messagesDelivered.some((m: any) => m.day === t.currentDay && m.status === 'delivered');
        const refund = Math.max(0, count - 1);
        report.push(`${id}: referrer ${t.referrerUserId} campaign ${t.campaignId ?? 'nouveaux'} day ${t.currentDay}, `
            + `${count} sends -> refund ${refund}${alreadyRecorded ? ' (day already recorded)' : ''}`);

        if (apply) {
            t.messagesDelivered.push({
                day: t.currentDay,
                channel: 'email',
                sentAt: now,
                status: 'delivered',
                errorMessage: REPAIR_MARKER,
            });
            t.lastMessageSentAt = now;
            await t.save();
        }
        repaired++;
        const ref = String(t.referrerUserId);
        refunds.set(ref, (refunds.get(ref) ?? 0) + refund);
    }

    for (const [userId, credits] of refunds) {
        if (credits <= 0) continue;
        report.push(`refund ${credits} email credits to parrain ${userId}`);
        if (apply) {
            await RelanceConfigModel.updateOne({ userId: new mongoose.Types.ObjectId(userId) }, { $inc: { emailBalance: credits } });
        }
    }
    return { repaired, refunds: Object.fromEntries(refunds), report };
}

if (require.main === module) {
    (async () => {
        if (!FILE) throw new Error('usage: repair-sms-crash-resends.ts <file> [--apply]');
        const entries = fs.readFileSync(FILE, 'utf8').split('\n').map(l => l.trim()).filter(Boolean).map(l => {
            const [id, count] = l.split(/\s+/);
            return { id, count: Number(count) };
        });
        await mongoose.connect(config.mongodb.uri);
        const result = await repairSmsCrashResends(entries, APPLY);
        result.report.forEach(l => console.log(l));
        console.log(`\n${APPLY ? 'APPLIED' : 'DRY RUN'}: ${result.repaired} target(s), refunds ${JSON.stringify(result.refunds)}`);
        await mongoose.disconnect();
    })().catch(err => { console.error(err); process.exit(1); });
}
