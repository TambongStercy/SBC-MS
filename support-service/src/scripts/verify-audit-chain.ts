/**
 * Verifies the audit log's hash chain end to end (contiguous seq, prevHash
 * links, recomputed hashes). Exit code 0 = intact, 1 = altered or broken.
 *
 *   npx ts-node src/scripts/verify-audit-chain.ts
 */
import mongoose from 'mongoose';
import { connectDB } from '../lib/db';
import { verifyAuditChain } from '../services/audit.service';

async function main() {
    await connectDB();
    const r = await verifyAuditChain();
    if (r.ok) process.stdout.write(`Audit chain intact: ${r.count} entries.\n`);
    else process.stdout.write(`AUDIT CHAIN BROKEN at seq ${r.firstBadSeq}: ${r.reason} (${r.count} entries verified before it).\n`);
    await mongoose.disconnect();
    process.exit(r.ok ? 0 : 1);
}

main().catch((err) => {
    process.stderr.write(`Failed: ${(err as Error).message}\n`);
    process.exit(2);
});
