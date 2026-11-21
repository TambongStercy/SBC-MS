/**
 * Security plan Phase 2: the Blnk sync worker, its own pm2 process (never
 * inside the API processes).
 *   - every 2 s: post the next wallet movements to Blnk (batches of 200);
 *   - every minute: alert when a movement has waited more than 5 min;
 *   - 02:00–05:00 Douala: the nightly shadow comparison of A, B and C.
 * Idles while BLNK_URL / BLNK_API_KEY are unset; BLNK_SYNC_DISABLED=true stops it.
 *
 *   node dist/workers/blnk-sync.worker.js
 */
import mongoose from 'mongoose';
import connectDB from '../database/connection';
import { blnkEnabled } from '../services/blnk/blnk.client';
import { LAG_ALERT_MS, shadowCompare, syncBatch, syncLagMs } from '../services/blnk/blnk-sync.service';
import { openSupportCase, startSupportCaseOutbox } from '../services/clients/support.service.client';
import logger from '../utils/logger';

const log = logger.getLogger('BlnkSyncWorker');
const disabled = () => String(process.env.BLNK_SYNC_DISABLED || '').toLowerCase() === 'true';
const doualaHour = (d = new Date()) => (d.getUTCHours() + 1) % 24;
const doualaDay = (d = new Date()) => new Date(d.getTime() + 3600_000).toISOString().slice(0, 10);

let stopping = false;
const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));

async function main() {
    await connectDB();
    startSupportCaseOutbox();
    log.info(`Blnk sync worker started (${blnkEnabled() ? 'enabled' : 'idle: BLNK_URL / BLNK_API_KEY unset'})`);
    let lastLagCheck = 0;
    let lastLagAlertHour = '';
    let shadowDoneFor = '';
    while (!stopping) {
        if (disabled() || !blnkEnabled()) { await sleep(60_000); continue; }
        let full = false;
        try {
            const r = await syncBatch(200);
            full = r.processed === 200 && !r.stopped;
            if (r.processed) log.info(`Blnk sync: ${r.synced} posted, ${r.skipped} skipped, ${r.rejected} rejected${r.stopped ? ` (stopped: ${r.stopped})` : ''}`);
            else if (r.stopped === 'blnk_unavailable') log.warn('Blnk unreachable: sync waits');
        } catch (err: any) {
            log.error(`Blnk sync pass failed: ${err?.message ?? err}`);
        }
        const now = Date.now();
        if (now - lastLagCheck > 60_000) {
            lastLagCheck = now;
            const lag = await syncLagMs().catch(() => 0);
            const hourKey = new Date().toISOString().slice(0, 13);
            if (lag > LAG_ALERT_MS && lastLagAlertHour !== hourKey) {
                lastLagAlertHour = hourKey;
                log.error(`Blnk sync lag ${Math.round(lag / 1000)} s`);
                void openSupportCase({
                    type: 'ledger_mismatch', dedupKey: `blnk:lag:${hourKey}`, severity: 'warning', subject: {},
                    summary: `Le second registre (Blnk) a ${Math.round(lag / 60000)} min de retard sur MongoDB : les retraits vérifiés attendront.`,
                });
            }
        }
        const h = doualaHour();
        if (h >= 2 && h < 5 && shadowDoneFor !== doualaDay()) {
            shadowDoneFor = doualaDay();
            const deadline = new Date(Date.now() + (5 - h) * 3600_000);
            await shadowCompare({ batch: 1000, pauseMs: 500, deadline }).catch((err: any) => log.error(`Shadow comparison failed: ${err?.message ?? err}`));
        }
        await sleep(full ? 50 : 2000);
    }
    await mongoose.disconnect();
}

for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => { stopping = true; });
main().catch(err => { log.error(`Blnk sync worker crashed: ${err?.message ?? err}`); process.exit(1); });
