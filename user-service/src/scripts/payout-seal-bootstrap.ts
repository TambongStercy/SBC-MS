/**
 * One-time sealing of every member's payout destination (utils/payout-seal.ts), then set
 * PAYOUT_SEAL_SINCE in .env so that a missing seal also counts as a tamper.
 * Members whose current MoMo number was never used for any of their past withdrawals (while other
 * numbers were) are listed, and with --cases filed as warning cases for support (no alert, nothing
 * frozen): those numbers may have been changed before the seal existed.
 *
 *   node dist/scripts/payout-seal-bootstrap.js            dry run (counts + the list, masked)
 *   node dist/scripts/payout-seal-bootstrap.js --apply [--cases]
 */
import mongoose from 'mongoose';
import config from '../config';
import { bootstrapPayoutSeals } from '../services/payout-seal.service';
import { sealEnabled } from '../utils/payout-seal';

(async () => {
    if (!sealEnabled()) throw new Error('PAYOUT_SEAL_KEY is not set (32+ characters)');
    const apply = process.argv.includes('--apply');
    await mongoose.connect(config.mongodb.uri);
    const r = await bootstrapPayoutSeals(apply, process.argv.includes('--cases'));
    console.log(`${apply ? 'APPLIED' : 'DRY RUN'}: ${r.unsealed} without a seal, ${r.sealed} sealed now`);
    console.log(`${r.mismatches.length} whose current MoMo number was never used for their withdrawals:`);
    for (const m of r.mismatches.slice(0, 50)) console.log(`  ${m.userId}  now ${m.current}  withdrew to ${m.withdrewTo.join(', ')}`);
    if (r.mismatches.length > 50) console.log(`  … and ${r.mismatches.length - 50} more`);
    await mongoose.disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
