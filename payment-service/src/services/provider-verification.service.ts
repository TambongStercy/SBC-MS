import axios from 'axios';
import https from 'https';
import config from '../config';
import logger from '../utils/logger';
import * as sandbox from './sandbox.service';
import { cinetpayPayoutService } from './cinetpay-payout.service';
import { feexPayPayoutService } from './feexpay-payout.service';
import nowPaymentsService from './nowpayments.service';
import { ITransaction } from '../database/models/transaction.model';

const log = logger.getLogger('ProviderVerification');
const ipv4Agent = new https.Agent({ family: 4 });

/**
 * Read-only questions to the providers ("did this payment / payout happen?"),
 * normalised to the contract's RecheckResult (§2.2). Nothing here changes our
 * data: callers decide what to apply (and apply it through the real handlers).
 *
 * `provider_unavailable` means the provider did not answer (network, 5xx, no
 * credentials, no status API): never evidence that a payment failed.
 */
export type RecheckOutcome = 'confirmed' | 'pending' | 'not_found' | 'failed' | 'provider_unavailable';

export interface ProviderAnswer {
    result: RecheckOutcome;
    provider: string;
    providerStatus: string;
    providerRef: string;
    amount?: number;
    currency?: string;
    /** Extra fields worth keeping (MF personal_Info, CinetPay operator...). */
    details?: Record<string, unknown>;
}

const httpStatus = (err: any): number | undefined => err?.response?.status;

/** Is this external reference a payment that really succeeded at the provider? */
export async function verifyPayinAtProvider(gateway: string, ref: string, opts: { countryCode?: string } = {}): Promise<ProviderAnswer> {
    const provider = String(gateway || '').toLowerCase();
    const base = { provider, providerRef: ref };
    if (!ref) return { ...base, result: 'not_found', providerStatus: 'no_reference' };

    if (sandbox.isSandboxActive() && sandbox.isSandboxRef(ref)) {
        const st = sandbox.refStatusNow(ref);
        return { ...base, result: st === 'completed' ? 'confirmed' : st === 'failed' ? 'failed' : 'pending', providerStatus: `SANDBOX ${st}` };
    }

    try {
        switch (provider) {
            case 'feexpay': {
                try {
                    const res = await axios.get(`${config.feexpay.baseUrl}/transactions/public/single/status/${encodeURIComponent(ref)}`, {
                        headers: { Authorization: `Bearer ${config.feexpay.apiKey}`, 'Content-Type': 'application/json' }, timeout: 15000,
                    });
                    const st = String(res.data?.status || '').toUpperCase();
                    return {
                        ...base, providerStatus: st || 'UNKNOWN',
                        result: st === 'SUCCESSFUL' ? 'confirmed' : st === 'FAILED' ? 'failed' : 'pending',
                        amount: Number(res.data?.amount) || undefined, currency: res.data?.currency,
                    };
                } catch (err: any) {
                    if (httpStatus(err) === 404) return { ...base, result: 'not_found', providerStatus: 'NOT_FOUND' };
                    throw err;
                }
            }
            case 'cinetpay': {
                const countries = opts.countryCode ? [opts.countryCode] : Object.keys(config.cinetpay.countries || {});
                let sawUnavailable = false;
                for (const cc of countries) {
                    try {
                        const token = await cinetpayPayoutService.getAccessToken(cc);
                        const res = await axios.get(`${config.cinetpay.baseUrl}/v1/payment/${encodeURIComponent(ref)}`, {
                            headers: { Authorization: `Bearer ${token}` }, httpsAgent: ipv4Agent, timeout: 15000,
                        });
                        const code = res.data?.code;
                        const st = String(res.data?.status || '').toUpperCase();
                        const result: RecheckOutcome = code === 100 || st === 'SUCCESS' ? 'confirmed'
                            : code === 2010 || code === 2003 || st === 'FAILED' || st === 'EXPIRED' ? 'failed' : 'pending';
                        return {
                            ...base, result, providerStatus: `${code ?? ''} ${st}`.trim(),
                            amount: Number(res.data?.data?.amount ?? res.data?.amount) || undefined,
                            currency: res.data?.data?.currency ?? res.data?.currency, details: { country: cc },
                        };
                    } catch (err: any) {
                        const status = httpStatus(err);
                        if (status === 404 || status === 422) continue; // not this country's account
                        sawUnavailable = true;
                        log.warn(`CinetPay payin check ${ref} (${cc}) failed: ${status ?? ''} ${err.message}`);
                    }
                }
                return sawUnavailable
                    ? { ...base, result: 'provider_unavailable', providerStatus: 'UNREACHABLE' }
                    : { ...base, result: 'not_found', providerStatus: 'NOT_FOUND' };
            }
            case 'moneyfusion': {
                const res = await axios.get(`https://www.pay.moneyfusion.net/paiementNotif/${encodeURIComponent(ref)}`, { timeout: 15000 });
                if (res.data?.statut !== true || !res.data?.data) return { ...base, result: 'not_found', providerStatus: 'NOT_FOUND' };
                const data = res.data.data;
                const st = String(data.statut ?? data.status ?? '').toLowerCase();
                const info = Array.isArray(data.personal_Info) ? data.personal_Info[0] : data.personal_Info;
                return {
                    ...base, providerStatus: st || 'unknown',
                    result: ['paid', 'success', 'completed'].includes(st) ? 'confirmed' : ['failure', 'cancelled', 'no paid'].includes(st) ? 'failed' : 'pending',
                    amount: Number(data.Montant) || undefined,
                    details: { personalInfo: info ? { userId: info.userId ?? null, sessionId: info.sessionId ?? null } : null, raw: data },
                };
            }
            case 'nowpayments': {
                const p = await nowPaymentsService.getPaymentStatus(ref);
                const st = String(p.paymentStatus || '').toLowerCase();
                return {
                    ...base, providerStatus: st || 'unknown',
                    result: st === 'finished' || st === 'confirmed' ? 'confirmed' : st === 'failed' || st === 'expired' || st === 'refunded' ? 'failed' : 'pending',
                    amount: Number(p.priceAmount) || undefined, currency: p.priceCurrency,
                    details: { orderId: p.orderId ?? null },
                };
            }
            default:
                return { ...base, result: 'provider_unavailable', providerStatus: 'UNSUPPORTED_GATEWAY' };
        }
    } catch (err: any) {
        log.warn(`Payin verification ${provider}/${ref} failed: ${httpStatus(err) ?? ''} ${err.message}`);
        return { ...base, result: 'provider_unavailable', providerStatus: 'UNREACHABLE' };
    }
}

/** What the provider says about a withdrawal's payout (read-only). MoneyFusion has no status API. */
export async function verifyPayoutAtProvider(tx: ITransaction): Promise<ProviderAnswer> {
    const provider = String(tx.serviceProvider || tx.metadata?.selectedPayoutService || tx.metadata?.serviceProvider || '').toLowerCase();
    const ref = tx.externalTransactionId || '';
    const base = { provider, providerRef: ref };
    if (!ref) return { ...base, result: 'not_found', providerStatus: 'NO_PROVIDER_REFERENCE' };
    const map = (st: string): RecheckOutcome => st === 'completed' ? 'confirmed' : st === 'failed' ? 'failed' : 'pending';
    try {
        if (provider === 'cinetpay') {
            const st = await cinetpayPayoutService.checkPayoutStatus(ref, tx.metadata?.accountInfo?.countryCode);
            if (!st) return { ...base, result: 'not_found', providerStatus: 'NOT_FOUND' };
            return { ...base, result: map(st.status), providerStatus: st.status, amount: st.amount, details: { comment: st.comment ?? null } };
        }
        if (provider === 'feexpay') {
            const st = await feexPayPayoutService.checkPayoutStatus(ref);
            return { ...base, result: map(st.status), providerStatus: st.status, amount: st.amount || undefined };
        }
        if (provider === 'nowpayments') {
            const st = await nowPaymentsService.getPayoutStatus(ref);
            const s = String(st.status || '').toLowerCase();
            return { ...base, result: s === 'finished' ? 'confirmed' : s === 'failed' || s === 'rejected' ? 'failed' : 'pending', providerStatus: s };
        }
        if (provider === 'moneyfusion') {
            if (sandbox.isSandboxActive() && sandbox.isSandboxRef(ref)) {
                return { ...base, result: map(sandbox.refStatusNow(ref)), providerStatus: `SANDBOX ${sandbox.refStatusNow(ref)}` };
            }
            return { ...base, result: 'provider_unavailable', providerStatus: 'NO_STATUS_API' };
        }
        return { ...base, result: 'provider_unavailable', providerStatus: 'UNSUPPORTED_GATEWAY' };
    } catch (err: any) {
        if (httpStatus(err) === 404 || err?.statusCode === 404) return { ...base, result: 'not_found', providerStatus: 'NOT_FOUND' };
        log.warn(`Payout verification ${provider}/${ref} failed: ${err.message}`);
        return { ...base, result: 'provider_unavailable', providerStatus: 'UNREACHABLE' };
    }
}
