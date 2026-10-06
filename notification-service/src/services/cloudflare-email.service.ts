import axios from 'axios';
import https from 'https';
import config from '../config';
import EmailProviderUsageModel from '../database/models/email-provider-usage.model';
import RelanceBounceSuppressionModel from '../database/models/relance-bounce-suppression.model';
import logger from '../utils/logger';

const log = logger.getLogger('CloudflareEmail');

/**
 * Relance emails through Cloudflare Email Sending (REST API).
 *
 * Billing is $5/month for 3,000 emails, then $0.35 per 1,000 — hard bounces
 * included — so every send is counted per month, and CLOUDFLARE_EMAIL_MONTHLY_CAP
 * can stop the paid path. Whatever Cloudflare does not take (not configured,
 * cap reached, refused, down) is reported as `fallback`, and the caller sends
 * it through iRedMail instead: a relance email is never lost to this path.
 */

export type CloudflareOutcome =
    | { status: 'sent' }
    /** The address does not exist: suppressed, and not worth retrying anywhere. */
    | { status: 'bounced' }
    | { status: 'fallback'; reason: string };

export interface CloudflareMessage {
    to: string;
    subject: string;
    html: string;
    headers?: Record<string, string>;
}

/**
 * Always IPv4. The API token is locked to the server's address, and this
 * server reaches api.cloudflare.com over IPv6 by default — which a token
 * filtered on the IPv4 address refuses ("Cannot use the access token from
 * location 2a02:…"), measured 2026-10-06.
 */
const ipv4 = new https.Agent({ family: 4, keepAlive: true });

const monthKey = (now: Date) => `cloudflare:${now.toISOString().slice(0, 7)}`;

/** "Name <addr>" or "addr" → the { address, name } Cloudflare expects. */
export function parseSender(from: string): { address: string; name?: string } {
    const m = from.match(/^\s*"?([^"<]*?)"?\s*<\s*([^>\s]+)\s*>\s*$/);
    if (m) return m[1] ? { address: m[2], name: m[1] } : { address: m[2] };
    return { address: from.trim() };
}

export function cloudflareEmailEnabled(): boolean {
    const cf = config.relanceEmail.cloudflare;
    return config.relanceEmail.provider === 'cloudflare' && !!cf.accountId && !!cf.apiToken;
}

/**
 * Counts one send against this month, unless the cap is already reached.
 * The filter-then-upsert races to a duplicate key once the month is full,
 * which is the "no" answer.
 */
async function reserveSend(now: Date): Promise<boolean> {
    const cap = config.relanceEmail.cloudflare.monthlyCap;
    const _id = monthKey(now);
    try {
        await EmailProviderUsageModel.updateOne(
            cap === null ? { _id } : { _id, count: { $lt: cap } },
            { $inc: { count: 1 } },
            { upsert: true },
        );
        return true;
    } catch (err: any) {
        if (err?.code === 11000) return false;
        throw err;
    }
}

/** Gives back a send Cloudflare did not take (and so did not bill). */
async function releaseSend(now: Date): Promise<void> {
    await EmailProviderUsageModel.updateOne({ _id: monthKey(now), count: { $gt: 0 } }, { $inc: { count: -1 } }).catch(() => undefined);
}

export async function sendRelanceViaCloudflare(msg: CloudflareMessage, now: Date = new Date()): Promise<CloudflareOutcome> {
    if (!cloudflareEmailEnabled()) return { status: 'fallback', reason: 'not configured' };
    if (!(await reserveSend(now))) return { status: 'fallback', reason: 'monthly cap reached' };

    const { accountId, apiToken } = config.relanceEmail.cloudflare;
    try {
        const res = await axios.post(
            `https://api.cloudflare.com/client/v4/accounts/${accountId}/email/sending/send`,
            {
                from: parseSender(config.relanceEmail.from),
                to: msg.to,
                subject: msg.subject,
                html: msg.html,
                ...(msg.headers ? { headers: msg.headers } : {}),
            },
            {
                headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
                timeout: 15_000,
                httpsAgent: ipv4,
                validateStatus: () => true,
            },
        );
        const result = res.data?.result ?? {};
        const listed = (key: string) => Array.isArray(result[key]) && result[key].some((a: unknown) => String(a).toLowerCase() === msg.to.toLowerCase());

        if (res.status >= 200 && res.status < 300 && res.data?.success) {
            if (listed('permanent_bounces')) {
                // Billed, but the address is dead: stop every relance to it.
                await RelanceBounceSuppressionModel.updateOne(
                    { email: msg.to.toLowerCase() },
                    { $setOnInsert: { email: msg.to.toLowerCase(), reason: 'Cloudflare permanent bounce', bouncedAt: now, source: 'cloudflare' } },
                    { upsert: true },
                ).catch(() => undefined);
                log.warn(`Permanent bounce for ${msg.to}; suppressed`);
                return { status: 'bounced' };
            }
            return { status: 'sent' };
        }

        await releaseSend(now);
        const errors = (res.data?.errors ?? []).map((e: any) => `${e.code} ${e.message}`).join('; ');
        log.warn(`Cloudflare refused ${msg.to} (HTTP ${res.status}${errors ? `: ${errors}` : ''}); using iRedMail`);
        return { status: 'fallback', reason: `HTTP ${res.status}${errors ? ` ${errors}` : ''}` };
    } catch (err: any) {
        await releaseSend(now);
        log.warn(`Cloudflare unreachable for ${msg.to} (${err?.message ?? err}); using iRedMail`);
        return { status: 'fallback', reason: err?.message ?? 'network error' };
    }
}
