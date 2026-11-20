/**
 * Security plan Phase 10: move abandoned payments (no provider chosen, older
 * than PAYIN_ARCHIVE_AFTER_DAYS, default 7) to paymentintents_archive. Never
 * deletes: each payment is copied whole first (see jobs/payin-archive.job.ts).
 *
 *   npx ts-node src/scripts/archive-abandoned-payins.ts            # dry run: counts only
 *   npx ts-node src/scripts/archive-abandoned-payins.ts --apply [--max=100000]
 */
export {};

const main = async () => {
    const apply = process.argv.includes('--apply');
    const maxArg = process.argv.find(a => a.startsWith('--max='));
    const config = (await import('../config')).default;
    const mongoose = (await import('mongoose')).default;
    await mongoose.connect(config.mongodb.uri);
    const { archiveAbandoned } = await import('../jobs/payin-archive.job');
    const r = await archiveAbandoned({ dryRun: !apply, max: maxArg ? Number(maxArg.slice(6)) : undefined });
    console.log(apply
        ? `Moved ${r.moved} abandoned payments to the archive (${r.keptBack} picked up meanwhile, left live). Eligible before the run: ${r.candidates}.`
        : `Dry run: ${r.candidates} abandoned payments would be moved. Run with --apply to move them.`);
    await mongoose.disconnect();
};

main().catch(e => { console.error(e); process.exit(1); });
