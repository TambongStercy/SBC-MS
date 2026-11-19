/**
 * READ-ONLY. How many MoneyFusion payments still "waiting for the provider"
 * were actually paid? (Security plan Phase 10, item 3, first run.)
 *
 * On 19 Nov 2026, 9,868 MoneyFusion payments were waiting for the provider,
 * 9,509 of them for more than 24 h, and only 75 had ever received a webhook.
 * PayinReconciler re-asks MoneyFusion only for the last 7 days, so most of them
 * have never been checked. This asks MoneyFusion about each one and reports.
 *
 * It changes NOTHING: no status, no credit, no webhook replay. A payment found
 * paid is listed so Sterling/Rufus decide what to do (credit through the normal
 * webhook handler with reconcile-payins.ts <sessionId>, or refund if the member
 * already paid again).
 *
 * Usage (on the server, in payment-service/):
 *   npx ts-node src/scripts/audit-stuck-moneyfusion-payins.ts
 *     [--min-age-hours=24]   only payments older than this (default 24)
 *     [--max-age-days=N]     only payments younger than this (default: all)
 *     [--limit=N]            stop after N payments (try --limit=50 first)
 *     [--rate=5]             MoneyFusion calls per second, at most 5
 *     [--include-error]      also payments in ERROR that have a MoneyFusion token
 *     [--out=path.csv]       where to write the list (default ./mf-stuck-audit-<date>.csv)
 */

import fs from 'fs';
import axios from 'axios';
import mongoose from 'mongoose';
import config from '../config';
import PaymentIntentModel from '../database/models/PaymentIntent';
import { PaymentGateway, PaymentStatus } from '../database/interfaces/IPaymentIntent';

const arg = (name: string): string | undefined => {
    const hit = process.argv.find(a => a === `--${name}` || a.startsWith(`--${name}=`));
    if (!hit) return undefined;
    return hit.includes('=') ? hit.split('=').slice(1).join('=') : 'true';
};

const MIN_AGE_HOURS = Number(arg('min-age-hours') ?? 24);
const MAX_AGE_DAYS = arg('max-age-days') ? Number(arg('max-age-days')) : null;
const LIMIT = arg('limit') ? Number(arg('limit')) : null;
const RATE = Math.min(5, Math.max(0.2, Number(arg('rate') ?? 5)));
const INCLUDE_ERROR = arg('include-error') === 'true';
const OUT = arg('out') || `./mf-stuck-audit-${new Date().toISOString().slice(0, 10)}.csv`;

type Verdict = 'paid' | 'failed' | 'pending' | 'not_found' | 'no_answer' | 'no_token';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * Same endpoint and reading as PayinReconciler.reconcileMoneyFusion, but
 * keeps "MoneyFusion answered: unknown token" apart from "no answer".
 */
async function askMoneyFusion(token: string): Promise<{ verdict: Verdict; statut?: string; montant?: unknown; raw?: any }> {
    try {
        const res = await axios.get(`${config.moneyfusion.statusUrl}/${encodeURIComponent(token)}`, { timeout: 15000 });
        if (res.data?.statut !== true || !res.data?.data) return { verdict: 'not_found', raw: res.data };
        const data = res.data.data;
        const statut = String(data.statut ?? data.status ?? '').toLowerCase();
        const verdict: Verdict = ['paid', 'success', 'completed'].includes(statut) ? 'paid'
            : ['failure', 'cancelled', 'no paid'].includes(statut) ? 'failed'
                : 'pending';
        return { verdict, statut, montant: data.Montant ?? data.montant, raw: data };
    } catch (e: any) {
        if (e?.response?.status === 404) return { verdict: 'not_found' };
        return { verdict: 'no_answer', statut: e?.code || String(e?.response?.status || e?.message || '') };
    }
}

const csv = (v: unknown) => {
    const s = v === undefined || v === null ? '' : v instanceof Date ? v.toISOString() : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

async function run() {
    await mongoose.connect(config.mongodb.uri);
    console.log(`Connected to database "${mongoose.connection.name}" — READ-ONLY audit, nothing is written.\n`);

    const now = Date.now();
    const createdAt: Record<string, Date> = { $lte: new Date(now - MIN_AGE_HOURS * 3600_000) };
    if (MAX_AGE_DAYS) createdAt.$gte = new Date(now - MAX_AGE_DAYS * 86400_000);
    const statuses = [PaymentStatus.PENDING_PROVIDER, PaymentStatus.PROCESSING, ...(INCLUDE_ERROR ? [PaymentStatus.ERROR] : [])];
    const filter = { gateway: PaymentGateway.MONEYFUSION, status: { $in: statuses }, createdAt };

    const total = await PaymentIntentModel.countDocuments(filter);
    const withToken = await PaymentIntentModel.countDocuments({ ...filter, gatewayPaymentId: { $exists: true, $nin: [null, ''] } });
    console.log(`${total} MoneyFusion payment(s) in ${statuses.join('/')} older than ${MIN_AGE_HOURS} h${MAX_AGE_DAYS ? `, younger than ${MAX_AGE_DAYS} d` : ''}`);
    console.log(`${withToken} have a MoneyFusion token and can be asked about; ${total - withToken} never got one.\n`);

    const out = fs.createWriteStream(OUT);
    out.write('sessionId,userId,createdAt,amount,currency,countryCode,paymentType,subscriptionType,status,verdict,mfStatut,mfMontant,paidAgainLater\n');

    const counts: Record<Verdict, number> = { paid: 0, failed: 0, pending: 0, not_found: 0, no_answer: 0, no_token: 0 };
    const paidSum: Record<string, number> = {};
    let paidAgain = 0;
    const paidByMonth: Record<string, number> = {};
    const paidByCountry: Record<string, number> = {};

    const cursor = PaymentIntentModel.find(filter)
        .sort({ createdAt: 1 })
        .select('sessionId userId createdAt amount currency countryCode paymentType subscriptionType status gatewayPaymentId')
        .lean()
        .cursor();

    let n = 0;
    const gap = Math.ceil(1000 / RATE);
    for await (const intent of cursor as AsyncIterable<any>) {
        if (LIMIT && n >= LIMIT) break;
        n++;
        let res: { verdict: Verdict; statut?: string; montant?: unknown };
        if (!intent.gatewayPaymentId) {
            res = { verdict: 'no_token' };
        } else {
            const started = Date.now();
            res = await askMoneyFusion(intent.gatewayPaymentId);
            const wait = gap - (Date.now() - started);
            if (wait > 0) await sleep(wait);
        }
        counts[res.verdict]++;

        let again = '';
        if (res.verdict === 'paid') {
            const cur = String(intent.currency || 'XAF');
            paidSum[cur] = (paidSum[cur] || 0) + Number(intent.amount || 0);
            const month = new Date(intent.createdAt).toISOString().slice(0, 7);
            paidByMonth[month] = (paidByMonth[month] || 0) + 1;
            paidByCountry[intent.countryCode || '?'] = (paidByCountry[intent.countryCode || '?'] || 0) + 1;
            // Did the member pay for the same thing again afterwards? Then
            // crediting this one would give it twice: a refund case instead.
            const later = await PaymentIntentModel.exists({
                userId: intent.userId,
                status: PaymentStatus.SUCCEEDED,
                createdAt: { $gt: intent.createdAt },
                ...(intent.paymentType ? { paymentType: intent.paymentType } : {}),
                ...(intent.subscriptionType ? { subscriptionType: intent.subscriptionType } : {}),
            });
            again = later ? 'yes' : 'no';
            if (later) paidAgain++;
        }

        out.write([
            intent.sessionId, intent.userId, intent.createdAt, intent.amount, intent.currency, intent.countryCode,
            intent.paymentType, intent.subscriptionType, intent.status, res.verdict, res.statut, res.montant, again,
        ].map(csv).join(',') + '\n');

        if (n % 200 === 0) {
            console.log(`… ${n} checked: ${counts.paid} paid, ${counts.failed} failed, ${counts.pending} pending, ${counts.not_found} unknown to MF, ${counts.no_answer} no answer`);
        }
    }
    out.end();

    console.log(`\n=== ${n} payment(s) checked ===`);
    console.log(`Paid at MoneyFusion but still waiting here : ${counts.paid}`);
    console.log(`   of which the member paid again later   : ${paidAgain} (crediting these would pay twice: refund case)`);
    console.log(`   never paid again                        : ${counts.paid - paidAgain} (credit through the webhook handler)`);
    console.log(`   amount                                  : ${Object.entries(paidSum).map(([c, a]) => `${Math.round(a).toLocaleString('fr-FR')} ${c}`).join(', ') || '0'}`);
    console.log(`Failed or cancelled at MoneyFusion        : ${counts.failed}`);
    console.log(`Still pending at MoneyFusion              : ${counts.pending}`);
    console.log(`Unknown to MoneyFusion                    : ${counts.not_found}`);
    console.log(`No answer (network/timeout, retry later)  : ${counts.no_answer}`);
    console.log(`No MoneyFusion token (never reached MF)   : ${counts.no_token}`);
    if (counts.paid) {
        console.log('\nPaid, by month created:', JSON.stringify(paidByMonth));
        console.log('Paid, by country:', JSON.stringify(paidByCountry));
    }
    console.log(`\nList written to ${OUT}. Nothing was changed.`);

    await mongoose.disconnect();
}

run().catch(async e => {
    console.error(e);
    await mongoose.disconnect();
    process.exit(1);
});
