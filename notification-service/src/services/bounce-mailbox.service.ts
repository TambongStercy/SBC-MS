import { ImapFlow } from 'imapflow';
import RelanceBounceSuppressionModel from '../database/models/relance-bounce-suppression.model';
import config from '../config';
import logger from '../utils/logger';

const log = logger.getLogger('BounceMailbox');

/**
 * Reads bounce reports (DSNs) from our own mailbox and suppresses addresses
 * that do not exist.
 *
 * Bounces used to reach us as SendGrid/SES webhooks. Since mail moved to our
 * own server, its Postfix accepts every message and tries delivery later; a
 * refusal comes back as a bounce email to the sender's mailbox (noreply@),
 * which nobody read. The suppression list the sender checks was never fed again.
 */

export type DsnRecipient = { email: string; action: string; status: string; diagnostic?: string };

/**
 * Per-recipient blocks of a message/delivery-status part (RFC 3464). Parses the
 * raw message text: header-style fields, blocks separated by blank lines.
 * Returns nothing for a message that is not a standard DSN rather than guess.
 */
export function parseDsn(raw: string): DsnRecipient[] {
    const marker = raw.search(/content-type:\s*message\/delivery-status/i);
    if (marker < 0) return [];
    const part = raw.slice(marker).replace(/\r\n/g, '\n');
    // Unfold continuation lines (a field value wrapped onto the next line).
    const unfolded = part.replace(/\n[ \t]+/g, ' ');
    const out: DsnRecipient[] = [];
    for (const block of unfolded.split(/\n\s*\n/)) {
        const field = (name: string) => block.match(new RegExp(`^${name}:\\s*(.+)$`, 'im'))?.[1].trim();
        const recipient = field('Final-Recipient') ?? field('Original-Recipient');
        const status = field('Status');
        const action = field('Action');
        if (!recipient || !status || !action) continue;
        const email = recipient.replace(/^rfc822;\s*/i, '').replace(/^<|>$/g, '').trim().toLowerCase();
        if (!email.includes('@')) continue;
        out.push({ email, action: action.toLowerCase(), status, diagnostic: field('Diagnostic-Code') });
    }
    return out;
}

/**
 * Only failures that say the address itself is bad. A 5.7.x refusal is the
 * receiving server blocking *us* (reputation, policy) — suppressing on it
 * would cut off real people. Full mailboxes (5.2.2) and anything temporary
 * (4.x.x) get another chance.
 */
export const isHardBounce = (r: DsnRecipient) =>
    r.action === 'failed' && /^5\.(1\.\d+|2\.1|4\.4)$/.test(r.status.split(/\s/)[0]);

/** Adds an address to the suppression list; a repeat bounce changes nothing. */
async function suppress(r: DsnRecipient): Promise<boolean> {
    const res = await RelanceBounceSuppressionModel.updateOne(
        { email: r.email },
        { $setOnInsert: { email: r.email, reason: `${r.status} ${r.diagnostic ?? ''}`.trim().slice(0, 500), bouncedAt: new Date(), source: 'smtp_dsn' } },
        { upsert: true },
    );
    return res.upsertedCount > 0;
}

/** What one pass needs from the mailbox, so the pass can be tested without a server. */
export interface BounceMailbox {
    /** Unread messages that look like bounces, oldest first. */
    unreadBounces(limit: number): Promise<Array<{ uid: number; source: string }>>;
    markRead(uids: number[]): Promise<void>;
}

export type BouncePassResult = { read: number; suppressed: number; ignored: number };

/** Reads unread bounces, suppresses the hard ones, marks every one read. Never deletes mail. */
export async function processBounces(mailbox: BounceMailbox, limit = 500): Promise<BouncePassResult> {
    const messages = await mailbox.unreadBounces(limit);
    let suppressed = 0;
    let ignored = 0;
    for (const m of messages) {
        for (const r of parseDsn(m.source)) {
            if (isHardBounce(r)) {
                if (await suppress(r)) suppressed++;
            } else {
                ignored++;
            }
        }
    }
    if (messages.length) await mailbox.markRead(messages.map(m => m.uid));
    return { read: messages.length, suppressed, ignored };
}

/** The real mailbox over IMAP. */
export async function withImapMailbox<T>(run: (mailbox: BounceMailbox) => Promise<T>): Promise<T> {
    const b = config.email.bounceMailbox;
    const client = new ImapFlow({
        host: b.host, port: b.port, secure: b.port === 993,
        auth: { user: b.user, pass: b.password },
        logger: false,
    });
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
        return await run({
            async unreadBounces(limit) {
                const uids = (await client.search({
                    seen: false,
                    or: [{ from: 'mailer-daemon' }, { header: { 'content-type': 'multipart/report' } }],
                }, { uid: true })) || [];
                const out: Array<{ uid: number; source: string }> = [];
                for await (const msg of client.fetch(uids.slice(0, limit), { uid: true, source: true }, { uid: true })) {
                    if (msg.source) out.push({ uid: msg.uid, source: msg.source.toString('utf8') });
                }
                return out;
            },
            async markRead(uids) {
                await client.messageFlagsAdd(uids, ['\\Seen'], { uid: true });
            },
        });
    } finally {
        lock.release();
        await client.logout().catch(() => undefined);
    }
}

let running = false;

export async function runBounceMailboxPass(): Promise<void> {
    if (running) return;
    running = true;
    try {
        const r = await withImapMailbox(mailbox => processBounces(mailbox));
        if (r.read) log.info(`Bounce mailbox: read ${r.read}, suppressed ${r.suppressed} new address(es), ${r.ignored} not permanent`);
    } catch (err: any) {
        log.error(`Bounce mailbox pass failed: ${err?.message ?? err}`);
    } finally {
        running = false;
    }
}
