/**
 * Credits relance packs that were paid for but never credited.
 *
 * Until 2026-09-30 the credit callback read userId from the payment's metadata,
 * which the purchase never put there, so every successful pack payment was
 * refused with a 400: 31 payments, May → September, each buyer left on 0
 * credits. This finds every SUCCEEDED relance-pack payment and credits the ones
 * that have no credit record yet.
 *
 * It goes through creditRelancePack — the same function the live callback uses
 * — so the credit amount comes from the pack table and each payment is credited
 * at most once. Running it twice is harmless.
 *
 * Reads sbc_payment; never writes to it.
 *
 * Crediting makes a user's relance able to send again. Do not --apply without
 * deciding that is wanted.
 *
 *   npx ts-node src/scripts/credit-unpaid-relance-packs.ts            # dry run
 *   npx ts-node src/scripts/credit-unpaid-relance-packs.ts --apply
 *
 * PAYMENT_DB_URI overrides where payments are read from (default: the
 * notification DB's host, database sbc_payment).
 */
import mongoose from 'mongoose';
import config from '../config';
import RelancePackCreditModel from '../database/models/relance-pack-credit.model';
import { creditRelancePack } from '../services/relance-credit.service';

const APPLY = process.argv.includes('--apply');

const paymentDbUri = () => {
    if (process.env.PAYMENT_DB_URI) return process.env.PAYMENT_DB_URI;
    const url = new URL(config.mongodb.uri);
    url.pathname = '/sbc_payment';
    return url.toString();
};

const main = async () => {
    await mongoose.connect(config.mongodb.uri);
    const payments = mongoose.createConnection(paymentDbUri());
    await payments.asPromise();

    const intents = await payments.collection('paymentintents').find({
        status: 'SUCCEEDED',
        'metadata.callbackPath': /relance\/internal\/credit-pack/,
    }).sort({ createdAt: 1 }).toArray();

    console.log(`${APPLY ? '*** APPLY ***' : '--- DRY RUN (pass --apply to credit) ---'}`);
    console.log(`Successful relance pack payments: ${intents.length}\n`);

    let credited = 0, already = 0, refused = 0, wouldCredit = 0;
    for (const intent of intents) {
        const sessionId = intent.sessionId as string;
        const userId = intent.userId ? String(intent.userId) : undefined;
        const packId = intent.metadata?.packId as string | undefined;
        const tag = `${sessionId} | user ${userId} | ${packId} | ${intent.amount} ${intent.currency} | ${new Date(intent.createdAt).toISOString().slice(0, 10)}`;

        if (!APPLY) {
            const done = await RelancePackCreditModel.exists({ sessionId });
            if (done) { already++; console.log(`SKIP  already credited: ${tag}`); }
            else { wouldCredit++; console.log(`WOULD CREDIT: ${tag}`); }
            continue;
        }

        const result = await creditRelancePack({ sessionId, userId, packId });
        if (result.outcome === 'credited') { credited++; console.log(`OK    +${result.credits} ${result.packType} (balance ${result.balance}): ${tag}`); }
        else if (result.outcome === 'already_credited') { already++; console.log(`SKIP  already credited: ${tag}`); }
        else { refused++; console.log(`FAIL  ${result.reason}: ${tag}`); }
    }

    console.log(APPLY
        ? `\nCredited ${credited}, already credited ${already}, refused ${refused}.`
        : `\nWould credit ${wouldCredit}, already credited ${already}.`);

    await payments.close();
    await mongoose.disconnect();
    process.exit(refused === 0 ? 0 : 1);
};

main().catch(async err => {
    console.error('Failed:', err);
    await mongoose.disconnect().catch(() => undefined);
    process.exit(1);
});
