/**
 * Ask the provider what happened to payments we were never told about.
 *
 * The same pass the PayinReconciler cron runs, on demand — for when someone is
 * standing in front of you saying they paid and the app is still asking them to.
 *
 * Only ever applies what the provider confirms. If the provider is unreachable
 * (FeexPay's status API was returning 502 the day this was written) nothing is
 * changed and the intent is left for the next attempt: an unanswered query is
 * not a failed payment.
 *
 * Usage (on the server, in payment-service/):
 *   npx ts-node src/scripts/reconcile-payins.ts                 # one full pass
 *   npx ts-node src/scripts/reconcile-payins.ts <sessionId>     # just this one
 */

import mongoose from 'mongoose';
import config from '../config';
import PaymentIntentModel from '../database/models/PaymentIntent';
import { payinReconciler } from '../jobs/payin-reconciler.job';

const [sessionId] = process.argv.slice(2).filter(a => !a.startsWith('--'));

const one = async (session: string) => {
    const intent = await PaymentIntentModel.findOne({ sessionId: session });
    if (!intent) {
        console.log(`No payment intent with sessionId ${session}`);
        return;
    }

    console.log(
        `${intent.sessionId} | ${intent.gateway} | ${intent.amount} ${intent.currency} `
        + `| ${intent.status} | ref=${intent.gatewayPaymentId ?? '(none)'}`,
    );

    if (!intent.gatewayPaymentId) {
        console.log('No provider reference — the provider never accepted this one, nothing to ask about.');
        return;
    }
    // Same dispatch as the scheduled pass, so every reconcilable gateway works
    // one-by-one too — this used to handle FeexPay only.
    const verdict = await payinReconciler.reconcileIntent(intent);
    console.log(`${intent.gateway} says: ${verdict}`);
    console.log(
        verdict === 'succeeded'
            ? 'Settled — the payment had gone through, and completion has now run.'
            : verdict === 'failed'
                ? 'Confirmed failed by the provider; marked as such.'
                : 'Left as-is; the provider did not confirm a completed payment.',
    );
};

const run = async () => {
    await mongoose.connect(config.mongodb.uri);
    console.log(`Connected to ${config.mongodb.uri}\n`);

    if (sessionId) {
        await one(sessionId);
    } else {
        const result = await payinReconciler.reconcile();
        console.log(
            `\n${result.checked} checked, ${result.settled} settled as paid, `
            + `${result.failed} confirmed failed, ${result.unresolved} still unknown.`,
        );
    }

    await mongoose.disconnect();
};

run().catch(async err => {
    console.error(err);
    await mongoose.disconnect().catch(() => undefined);
    process.exit(1);
});
