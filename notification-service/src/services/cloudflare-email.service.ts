import axios from 'axios';
import https from 'https';
import config from '../config';
import EmailProviderUsageModel from '../database/models/email-provider-usage.model';
import RelanceBounceSuppressionModel from '../database/models/relance-bounce-suppression.model';
import logger from '../utils/logger';

const log = logger.getLogger('CloudflareEmail');

/**
 * Cloudflare Email Sending as the OTP overflow (SMART-SENDER-OVERFLOW-SPEC).
 *
 * Our own mail server is primary for everything. When its minute is full, an
 * OTP that would otherwise wait goes out here instead. Cloudflare caps us at
 * 1,000 emails a day (the increase was refused), so this is OTP only — never
 * relance — and stops at `cloudflareEmail.dailyCap` (900) to keep headroom.
 * OTPs keep an identity of their own — noreply.sniperbuisnesscenter.com, the
 * domain onboarded in Cloudflare for them (CLOUDFLARE_OTP_FROM) — never the
 * relance one: mixing them would hurt both.
 *
 * Billed $0.35 per 1,000 past 3,000/month, hard bounces included. Every send is
 * counted per day (the cap) and per month (to compare with the bill).
 */

export type CloudflareOutcome =
    | { status: 'sent' }
    /** The address does not exist: blocked for every email, not worth retrying. */
    | { status: 'bounced' }
    | { status: 'unavailable'; reason: string };

export interface CloudflareMessage {
    to: string;
    subject: string;
    html: string;
    text?: string;
}

/**
 * Always IPv4. The API token is locked to the server's IPv4, and this server
 * reaches api.cloudflare.com over IPv6 by default — which the token refuses
 * ("Cannot use the access token from location 2a02:…"), measured 2026-10-06.
 */
const ipv4 = new https.Agent({ family: 4, keepAlive: true });

/** After Cloudflare refuses (quota, token, domain), leave it alone for a while. */
const PAUSE_AFTER_REFUSAL_MS = 60 * 60 * 1000;
let pausedUntil = 0;
export const resetCloudflarePause = () => { pausedUntil = 0; };

const dayKey = (now: Date) => `cloudflare:${now.toISOString().slice(0, 10)}`;
const monthKey = (now: Date) => `cloudflare:${now.toISOString().slice(0, 7)}`;

/** "Name <addr>" or "addr" → the { address, name } Cloudflare expects. */
export function parseSender(from: string): { address: string; name?: string } {
    const m = from.match(/^\s*"?([^"<]*?)"?\s*<\s*([^>\s]+)\s*>\s*$/);
    if (m) return m[1] ? { address: m[2], name: m[1] } : { address: m[2] };
    return { address: from.trim() };
}

export function cloudflareOtpOverflowEnabled(): boolean {
    const cf = config.cloudflareEmail;
    return cf.otpOverflow && !!cf.accountId && !!cf.apiToken && cf.dailyCap > 0;
}

const release = (_id: string) =>
    EmailProviderUsageModel.updateOne({ _id, count: { $gt: 0 } }, { $inc: { count: -1 } }).then(() => undefined, () => undefined);

/**
 * Counts one send against today and this month, unless a cap is reached. A
 * full day/month fails the filter, and the upsert then hits a duplicate key —
 * that is the "no".
 */
async function reserveSend(now: Date): Promise<boolean> {
    const { dailyCap, monthlyCap } = config.cloudflareEmail;
    const take = async (_id: string, cap: number | null) => {
        try {
            await EmailProviderUsageModel.updateOne(cap === null ? { _id } : { _id, count: { $lt: cap } }, { $inc: { count: 1 } }, { upsert: true });
            return true;
        } catch (err: any) {
            if (err?.code === 11000) return false;
            throw err;
        }
    };
    if (!(await take(dayKey(now), dailyCap))) return false;
    if (!(await take(monthKey(now), monthlyCap))) {
        await release(dayKey(now));
        return false;
    }
    return true;
}

/** Gives back a send Cloudflare did not take (and so did not bill). */
const releaseSend = async (now: Date) => { await release(dayKey(now)); await release(monthKey(now)); };

/**
 * Branded templates embed the logo as an inline cid: attachment. Cloudflare's
 * REST API documents no inline content-id, so the overflow copy goes without
 * the logo rather than with a broken image.
 */
const withoutInlineLogo = (html: string) => html.replace(/<img\b[^>]*src=["']cid:sbc-logo["'][^>]*>/gi, '');

export async function sendOtpViaCloudflare(msg: CloudflareMessage, now: Date = new Date()): Promise<CloudflareOutcome> {
    if (!cloudflareOtpOverflowEnabled()) return { status: 'unavailable', reason: 'not configured' };
    if (now.getTime() < pausedUntil) return { status: 'unavailable', reason: 'paused after a refusal' };
    if (!(await reserveSend(now))) return { status: 'unavailable', reason: 'daily cap reached' };

    const { accountId, apiToken } = config.cloudflareEmail;
    try {
        const res = await axios.post(
            `https://api.cloudflare.com/client/v4/accounts/${accountId}/email/sending/send`,
            {
                from: parseSender(config.cloudflareEmail.otpFrom),
                to: msg.to,
                subject: msg.subject,
                html: withoutInlineLogo(msg.html),
                ...(msg.text ? { text: msg.text } : {}),
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
                // Billed, but the address is dead: block it for every email.
                // $set, so a bounce also overrides an earlier relance unsubscribe.
                await RelanceBounceSuppressionModel.updateOne(
                    { email: msg.to.toLowerCase() },
                    { $set: { reason: 'Cloudflare permanent bounce', bouncedAt: now, source: 'cloudflare' } },
                    { upsert: true },
                ).catch(() => undefined);
                log.warn(`Permanent bounce for ${msg.to}; suppressed`);
                return { status: 'bounced' };
            }
            return { status: 'sent' };
        }

        await releaseSend(now);
        const errors = (res.data?.errors ?? []).map((e: any) => `${e.code} ${e.message}`).join('; ');
        // Quota, token or domain trouble will not fix itself in a minute.
        if (res.status === 401 || res.status === 403 || res.status === 429) pausedUntil = now.getTime() + PAUSE_AFTER_REFUSAL_MS;
        log.warn(`Cloudflare refused an OTP to ${msg.to} (HTTP ${res.status}${errors ? `: ${errors}` : ''})`);
        return { status: 'unavailable', reason: `HTTP ${res.status}${errors ? ` ${errors}` : ''}` };
    } catch (err: any) {
        await releaseSend(now);
        log.warn(`Cloudflare unreachable for an OTP to ${msg.to} (${err?.message ?? err})`);
        return { status: 'unavailable', reason: err?.message ?? 'network error' };
    }
}
