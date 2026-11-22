/**
 * Asserts gateway utils/backup-metrics.ts: the status file written by scripts/backup becomes
 * sbc_backup_* / sbc_restore_test_* series; a kind absent from the file has no series; a missing
 * or broken file gives no series and no error.
 *   npx ts-node --transpile-only src/scripts/check-backup-metrics.ts
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sbc-bk-'));
const file = path.join(dir, 'status.json');
process.env.BACKUP_STATUS_FILE = file;
let failures = 0;
const check = (label: string, ok: boolean, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`); if (!ok) failures++; };
const wait = () => new Promise((r) => setTimeout(r, 5100)); // the reader caches 5 s

(async () => {
    const { registry } = await import('../utils/metrics');
    await import('../utils/backup-metrics');
    let t = await registry.metrics();
    check('no file → no backup series, no error', !/sbc_backup_last_ok\{/.test(t));
    fs.writeFileSync(file, JSON.stringify({
        mongo_preprod: { lastOk: true, lastSuccessAt: 1795000000, running: false, sizeBytes: 123456 },
        blnk_offsite: { lastOk: false, lastFailureAt: 1795000100, running: false },
        restore_mongo_preprod: { at: 1795000200, ok: true, documents: 5600 },
        restore_blnk_preprod: { at: 1795000300, ok: false, detail: 'x' },
    }));
    await wait();
    t = await registry.metrics();
    check('last success time per kind', /sbc_backup_last_success_timestamp_seconds\{kind="mongo_preprod"[^}]*\} 1795000000/.test(t));
    check('a failed backup → last_ok 0, and no success time invented', /sbc_backup_last_ok\{kind="blnk_offsite"[^}]*\} 0/.test(t) && !/sbc_backup_last_success_timestamp_seconds\{kind="blnk_offsite"/.test(t));
    check('size', /sbc_backup_size_bytes\{kind="mongo_preprod"[^}]*\} 123456/.test(t));
    check('restore tests: ok 1 / 0, time, documents', /sbc_restore_test_ok\{kind="mongo_preprod"[^}]*\} 1/.test(t) && /sbc_restore_test_ok\{kind="blnk_preprod"[^}]*\} 0/.test(t)
        && /sbc_restore_test_timestamp_seconds\{kind="blnk_preprod"[^}]*\} 1795000300/.test(t) && /sbc_restore_test_documents\{kind="mongo_preprod"[^}]*\} 5600/.test(t));
    check('a kind not in the file has no series', !/kind="mongo"[,}]/.test(t));
    fs.writeFileSync(file, '{ broken');
    await wait();
    t = await registry.metrics();
    check('broken file → series gone, no error', !/sbc_backup_last_ok\{/.test(t));
    fs.rmSync(dir, { recursive: true, force: true });
    console.log(failures ? `\n${failures} FAILED` : '\nall passed');
    process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
