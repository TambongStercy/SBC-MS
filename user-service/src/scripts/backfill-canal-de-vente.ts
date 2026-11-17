/**
 * Gives every active Pack Winner member their canal de vente link: a member
 * who already has one on the canal backend (same referral code) just gets it
 * added to their account; the others get a new one. No WhatsApp message
 * unless --notify (hundreds at once could get the number banned).
 *
 *   npx ts-node src/scripts/backfill-canal-de-vente.ts            # dry run: counts only
 *   npx ts-node src/scripts/backfill-canal-de-vente.ts --apply
 */
import mongoose from 'mongoose';
import config from '../config';
import { ensureMissingCanalLinks, isCanalConfigured } from '../services/canal-de-vente.service';

async function main() {
    if (!isCanalConfigured()) throw new Error('CANAL_SERVICE_SECRET is not set');
    await mongoose.connect(config.mongodb.uri, { serverSelectionTimeoutMS: 10000 });
    const apply = process.argv.includes('--apply');
    const result = await ensureMissingCanalLinks({ dryRun: !apply, force: true, notify: process.argv.includes('--notify') });
    console.log(apply ? 'Done:' : 'Dry run:', JSON.stringify(result));
    if (!apply && result.missing) console.log('Re-run with --apply to link them.');
    await mongoose.disconnect();
}

main().catch(async err => {
    console.error(err);
    await mongoose.disconnect().catch(() => undefined);
    process.exit(1);
});
