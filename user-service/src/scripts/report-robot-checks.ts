/**
 * Security plan Phase 9 rule 3: what ROBOT_CHECK=enforce WOULD refuse, from the gateway's
 * log-mode counts (`robot_check_days`). Read-only.
 *
 *   node dist/scripts/report-robot-checks.js [--days 14]
 *
 * Per action: requests, share without a valid answer and why (missing = app version
 * without the check or a script; invalid/replay = forged or reused; expired = solved too
 * late), then the same per browser family and Android version for real browsers.
 */
import mongoose from 'mongoose';
import config from '../config';
import { RobotCheckDayModel } from '../database/models/session-key.model';

const args = process.argv.slice(2);
const days = Math.max(1, Number(args[args.indexOf('--days') + 1]) || 14);

const main = async () => {
    await mongoose.connect(config.mongodb.uri);
    const since = new Date(Date.now() + 3600_000 - days * 86400_000).toISOString().slice(0, 10);
    const rows = await RobotCheckDayModel.find({ day: { $gte: since } }).lean();
    const tally = (keyOf: (r: any) => string) => {
        const by = new Map<string, { total: number; valid: number; reasons: Record<string, number> }>();
        for (const r of rows as any[]) {
            const k = keyOf(r);
            const e = by.get(k) ?? { total: 0, valid: 0, reasons: {} };
            e.total += r.count ?? 0;
            if (r.outcome === 'valid') e.valid += r.count ?? 0;
            else e.reasons[r.outcome] = (e.reasons[r.outcome] ?? 0) + (r.count ?? 0);
            by.set(k, e);
        }
        for (const [k, e] of [...by].sort((a, b) => b[1].total - a[1].total)) {
            const fail = e.total - e.valid;
            console.log(`${k.padEnd(34)} ${String(e.total).padStart(9)}  would refuse ${(100 * fail / Math.max(e.total, 1)).toFixed(2).padStart(6)}%  ${JSON.stringify(e.reasons)}`);
        }
    };
    console.log(`Protected actions since ${since} (log mode, nothing refused):\n`);
    tally(r => r.action);
    console.log('\nBy browser (all actions):\n');
    tally(r => `${r.browser}/android ${r.android}/${r.client}`);
    await mongoose.disconnect();
};

main().catch(e => { console.error(e); process.exit(1); });
