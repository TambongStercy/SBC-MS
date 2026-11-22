/**
 * Backups and restore tests (Security plan Phase 0 item 4), read by the gateway at each scrape from
 * the status file the backup scripts write on this server (scripts/backup, /var/lib/sbc-backup/
 * status.json, no secret in it). Grafana alerts from these: a backup older than 26 h, a failed
 * backup, a failed or stale restore test.
 *   sbc_backup_last_success_timestamp_seconds{kind}  kind = mongo | mongo_preprod | blnk_preprod | blnk_offsite
 *   sbc_backup_last_ok{kind}  sbc_backup_running{kind}  sbc_backup_size_bytes{kind}
 *   sbc_restore_test_timestamp_seconds{kind}  sbc_restore_test_ok{kind}  sbc_restore_test_documents{kind}
 * A kind absent from the file has no series (no alert for a backup not installed here).
 */
import fs from 'fs';
import client from 'prom-client';
import { registry } from './metrics';

const FILE = process.env.BACKUP_STATUS_FILE || '/var/lib/sbc-backup/status.json';
type Entry = Record<string, unknown>;

let cache: { at: number; data: Record<string, Entry> } | null = null;
function read(): Record<string, Entry> {
    if (cache && Date.now() - cache.at < 5000) return cache.data;
    let data: Record<string, Entry> = {};
    try {
        const parsed = JSON.parse(fs.readFileSync(FILE, 'utf8'));
        if (parsed && typeof parsed === 'object') data = parsed;
    } catch { /* not installed on this server, or being rewritten: no series */ }
    cache = { at: Date.now(), data };
    return data;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const backups = () => Object.entries(read()).filter(([k, v]) => !k.startsWith('restore_') && v && typeof v === 'object');
const restores = () => Object.entries(read()).filter(([k, v]) => k.startsWith('restore_') && v && typeof v === 'object')
    .map(([k, v]) => [k.slice('restore_'.length), v] as const);

function gauge(name: string, help: string, rows: () => (readonly [string, Entry])[], pick: (e: Entry) => number | null) {
    new client.Gauge({
        name, help, labelNames: ['kind'], registers: [registry],
        collect() {
            this.reset();
            for (const [kind, e] of rows()) {
                const v = pick(e);
                if (v !== null) this.set({ kind }, v);
            }
        },
    });
}

gauge('sbc_backup_last_success_timestamp_seconds', 'Last successful backup (unix time)', backups, (e) => num(e.lastSuccessAt));
gauge('sbc_backup_last_ok', '1 if the last backup run succeeded, 0 if it failed', backups, (e) => (typeof e.lastOk === 'boolean' ? (e.lastOk ? 1 : 0) : null));
gauge('sbc_backup_running', '1 while a backup runs', backups, (e) => (e.running === true ? 1 : 0));
gauge('sbc_backup_size_bytes', 'Size of the last successful backup', backups, (e) => num(e.sizeBytes));
gauge('sbc_restore_test_timestamp_seconds', 'Last restore test (unix time)', restores, (e) => num(e.at));
gauge('sbc_restore_test_ok', '1 if the last restore test passed', restores, (e) => (typeof e.ok === 'boolean' ? (e.ok ? 1 : 0) : null));
gauge('sbc_restore_test_documents', 'Documents (Mongo) or rows (Blnk) restored by the last test', restores, (e) => num(e.documents) ?? num(e.rows));
