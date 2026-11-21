/**
 * Security plan Phase 9: what enforcement WOULD refuse, from the gateway's
 * log-only counts (`browser_check_days`). Read-only.
 *
 *   node dist/scripts/report-browser-checks.js [--days 14]
 *
 * For signed-in members: share of requests that would fail, per browser
 * family and Android version (the plan's bar: under 0.1% of real browser
 * sessions), and the failure reasons. Tool user-agents are listed apart.
 */
import mongoose from 'mongoose';
import config from '../config';
import { BrowserCheckDayModel } from '../database/models/session-key.model';

const args = process.argv.slice(2);
const days = Math.max(1, Number(args[args.indexOf('--days') + 1]) || 14);
const PASS = new Set(['valid', 'valid_late']);

const main = async () => {
    await mongoose.connect(config.mongodb.uri);
    const since = new Date(Date.now() + 3600_000 - days * 86400_000).toISOString().slice(0, 10);
    const rows = await BrowserCheckDayModel.find({ day: { $gte: since }, role: 'member' }).lean();
    const by = new Map<string, { total: number; pass: number; reasons: Record<string, number> }>();
    let tools = 0;
    for (const r of rows) {
        if (r.tool) { tools += r.count ?? 0; continue; }
        const k = `${r.browser}/android ${r.android}/${r.client}`;
        const e = by.get(k) ?? { total: 0, pass: 0, reasons: {} };
        e.total += r.count ?? 0;
        if (PASS.has(String(r.signature))) e.pass += r.count ?? 0;
        else e.reasons[String(r.signature)] = (e.reasons[String(r.signature)] ?? 0) + (r.count ?? 0);
        by.set(k, e);
    }
    console.log(`Member requests since ${since} (log-only, nothing refused):\n`);
    for (const [k, e] of [...by].sort((a, b) => b[1].total - a[1].total)) {
        const fail = e.total - e.pass;
        console.log(`${k.padEnd(36)} ${String(e.total).padStart(9)}  would fail ${(100 * fail / Math.max(e.total, 1)).toFixed(2).padStart(6)}%  ${JSON.stringify(e.reasons)}`);
    }
    console.log(`\nTool user-agents (Postman, curl, scripts…) with a member token: ${tools}`);
    await mongoose.disconnect();
};

main().catch(e => { console.error(e); process.exit(1); });
