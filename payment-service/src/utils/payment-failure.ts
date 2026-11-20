/**
 * Why a payment did not finish (Security plan Phase 10, "Why members do not
 * pay"). Until 2026-11-19 a payment set to ERROR or FAILED kept no reason, so
 * 2,812 MoneyFusion errors in 30 days could not be explained.
 *
 * The group is decided once, here, when the failure is recorded, so the
 * admin screen never matches text when it loads:
 * - `sbc_code`: our code failed (exception, wrong amount sent, credit failed);
 * - `provider_api`: the provider timed out, was unreachable, answered an HTTP
 *   error or refused our request (credentials, IP allow-list);
 * - `member`: low balance or limit, number not recognised, cancelled or
 *   declined, expired, missing details;
 * - `unknown`: no usable reason. Reviewed, then a rule is added below.
 */

export type FailureGroup = 'sbc_code' | 'provider_api' | 'member' | 'unknown';

/** Where the payment was when it failed. */
export type FailureStep = 'initiate' | 'provider_result' | 'status_check' | 'completion';

export interface PaymentFailure {
    group: FailureGroup;
    code: string;
    gateway?: string;
    providerCode?: string;
    providerMessage?: string;
    step: FailureStep;
    httpStatus?: number;
    requestId?: string;
    at: Date;
}

interface Rule { test: RegExp; group: FailureGroup; code: string }

/**
 * Provider and internal texts, matched without accents and in lower case.
 * Order matters: the first rule that matches wins.
 */
const RULES: Rule[] = [
    // The provider refused US (configuration), whatever the wording.
    { test: /adresse ip|ip address|non autoris|unauthori[sz]ed|forbidden|authentication failed|invalid (api )?key|api key|credential|merchant (not|in)|compte marchand/, group: 'provider_api', code: 'provider_config' },
    // Amounts are ours to get right (RDC was sent in USD until 2026-11-19).
    { test: /montant doit|amount must|invalid payment amount|invalid original amount|must be in xaf|multiple of/, group: 'sbc_code', code: 'amount_refused' },
    { test: /below the minimum|minimum required|montant minimum/, group: 'member', code: 'amount_below_minimum' },
    { test: /rate limit|too many requests|trop de requetes/, group: 'provider_api', code: 'provider_rate_limited' },
    { test: /insuffi|not enough|low balance|solde/, group: 'member', code: 'insufficient_balance' },
    { test: /limit|plafond|exceed|depass/, group: 'member', code: 'limit_reached' },
    { test: /payer not found|subscriber not found|introuvable|numero (invalide|incorrect|inconnu|non valide)|invalid (phone|number|msisdn)|non reconnu|not registered|unregistered|n.est pas (un )?abonne|invalid phone number format/, group: 'member', code: 'number_not_recognised' },
    { test: /cancel|annul|declin|rejected by (the )?(user|customer|payer)|refuse par|refused by (the )?(user|customer|payer)|abandon/, group: 'member', code: 'cancelled_by_payer' },
    { test: /expir/, group: 'member', code: 'expired' },
    { test: /phone number is required|operator selection is required|aucun numero de telephone|otp is required|choisissez|operator is required/, group: 'member', code: 'missing_details' },
    { test: /timed out|timeout/, group: 'provider_api', code: 'provider_timeout' },
    { test: /unable to (reach|connect)|connectivity|refused or reset|econnrefused|enotfound|eai_again|socket hang up|temporarily unavailable/, group: 'provider_api', code: 'provider_unreachable' },
];

const TRANSPORT_CODES: Record<string, string> = {
    ECONNABORTED: 'provider_timeout',
    ETIMEDOUT: 'provider_timeout',
    ECONNREFUSED: 'provider_unreachable',
    ECONNRESET: 'provider_unreachable',
    ENOTFOUND: 'provider_unreachable',
    EAI_AGAIN: 'provider_unreachable',
    EHOSTUNREACH: 'provider_unreachable',
};

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** The first rule matching a provider or internal text, if any. */
export function classifyText(text: string | undefined | null): { group: FailureGroup; code: string } | null {
    if (!text) return null;
    const t = fold(String(text));
    const rule = RULES.find(r => r.test.test(t));
    return rule ? { group: rule.group, code: rule.code } : null;
}

const clip = (s: unknown, max = 300): string | undefined => {
    if (s === undefined || s === null || s === '') return undefined;
    const str = typeof s === 'string' ? s : JSON.stringify(s);
    return str.length > max ? `${str.slice(0, max)}…` : str;
};

/** A readable message out of a provider body, whatever its shape. */
export function providerMessageOf(body: any): string | undefined {
    if (!body || typeof body !== 'object') return clip(body);
    for (const key of ['message', 'reason', 'description', 'status_message', 'statusMessage', 'error_message', 'error', 'detail', 'comment', 'libelle']) {
        const v = body[key];
        if (typeof v === 'string' && v.trim()) return clip(v);
        if (v && typeof v === 'object' && typeof v.message === 'string') return clip(v.message);
    }
    return undefined;
}

/** A provider code out of a provider body (CinetPay `code`, NOWPayments `payment_status`…). */
export function providerCodeOf(body: any): string | undefined {
    if (!body || typeof body !== 'object') return undefined;
    for (const key of ['code', 'status_code', 'statusCode', 'error_code', 'errorCode', 'payment_status', 'event', 'status']) {
        const v = body[key];
        if (v !== undefined && v !== null && v !== '' && (typeof v === 'string' || typeof v === 'number')) return String(v);
    }
    return undefined;
}

/**
 * A failure out of an exception thrown while starting a payment. Works on raw
 * axios errors (HTTP status, provider body, transport code) and on the plain
 * Errors our provider clients throw.
 */
export function failureFromError(error: any, ctx: { step: FailureStep; gateway?: string; requestId?: string }): PaymentFailure {
    const base = { step: ctx.step, gateway: ctx.gateway, requestId: ctx.requestId, at: new Date() };
    const message: string = String(error?.message ?? error ?? '');
    const httpStatus: number | undefined = typeof error?.response?.status === 'number' ? error.response.status : undefined;
    const body = error?.response?.data;
    const providerMessage = providerMessageOf(body) ?? clip(message);
    const providerCode = providerCodeOf(body);

    const transport = error?.code && TRANSPORT_CODES[String(error.code)];
    if (transport) return { ...base, group: 'provider_api', code: transport, providerMessage };

    const byText = classifyText(providerMessageOf(body)) ?? classifyText(message);
    if (byText) return { ...base, ...byText, httpStatus, providerCode, providerMessage };

    if (httpStatus !== undefined) {
        return { ...base, group: 'provider_api', code: httpStatus >= 500 ? 'provider_http_5xx' : 'provider_http_4xx', httpStatus, providerCode, providerMessage };
    }
    if (error?.providerRefusal) {
        return { ...base, group: 'provider_api', code: 'provider_refused', providerCode, providerMessage };
    }
    return { ...base, group: 'sbc_code', code: 'exception', providerMessage: clip(message) };
}

/**
 * A failure out of a provider's final answer (webhook or status check) that
 * the payment failed or expired.
 */
export function failureFromProviderResult(args: {
    gateway?: string;
    status: string;
    providerData?: any;
    requestId?: string;
}): PaymentFailure {
    const data = args.providerData ?? {};
    // CinetPay's verified answer sits under `verifiedStatus`.
    const verified = data.verifiedStatus ?? data;
    const providerCode = providerCodeOf(verified) ?? providerCodeOf(data);
    const providerMessage = providerMessageOf(verified) ?? providerMessageOf(data);
    const base = { step: 'provider_result' as FailureStep, gateway: args.gateway, providerCode, providerMessage, requestId: args.requestId, at: new Date() };

    const byText = classifyText(providerMessage);
    if (byText) return { ...base, ...byText };

    const gw = String(args.gateway || '').toLowerCase();
    const code = String(providerCode || '').toLowerCase();
    if (args.status === 'EXPIRED' || code === 'expired' || code === '2003') return { ...base, group: 'member', code: 'expired' };
    if (gw === 'moneyfusion' && /cancel/.test(code)) return { ...base, group: 'member', code: 'cancelled_by_payer' };
    if (gw === 'nowpayments' && code === 'refunded') return { ...base, group: 'member', code: 'refunded' };
    if (args.status === 'CANCELED') return { ...base, group: 'member', code: 'cancelled_by_payer' };
    // CinetPay 2010 / status 300, FeexPay "ECHEC": a failure without a reason.
    return { ...base, group: 'unknown', code: 'failed_without_reason' };
}
