/**
 * WhatsApp MY-STATUS EXTRACTOR — the working path, production-shaped.
 *
 * Links a WhatsApp account, pulls ONLY that account's own status posts from the
 * last 24h (posted before connecting — no waiting, no live listening), downloads
 * their media, records each status's viewer list, then unlinks and exits.
 *
 * Depends on patches/@whiskeysockets+baileys+6.7.18.patch. Upstream Baileys
 * cannot do this: three separate gates each hide the next —
 *   1. Utils/validate-connection.js  send DeviceProps.historySyncConfig
 *      -> without it the server never OFFERS the INITIAL_STATUS_V3 phase
 *   2. Defaults/index.js             whitelist INITIAL_STATUS_V3
 *      -> without it the blob is offered but never DOWNLOADED
 *   3. Utils/history.js              case reading statusV3Messages
 *      -> without it the blob downloads and DECODES TO NOTHING
 * See WHATSAPP-STATUS-FINDINGS.md.
 *
 * Usage:
 *   npx ts-node src/scripts/whatsapp-my-status.ts
 *   NO_MEDIA=1 npx ts-node src/scripts/whatsapp-my-status.ts   # metadata only
 *
 * Output: src/scripts/my-status-output/<timestamp>/
 *   metadata.json           statuses with captions + viewer lists
 *   media/<statusId>.<ext>  downloaded image/video
 * The ephemeral auth dir is deleted and the device unlinked on exit.
 *
 * NOTE: output contains real phone numbers. The directory is gitignored.
 */
import type { WAMessage, WASocket } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import qrcodeTerminal from 'qrcode-terminal';
import fs from 'fs/promises';
import path from 'path';
import { createHash } from 'crypto';

const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');
const OUTPUT_DIR = path.join(__dirname, 'my-status-output', RUN_ID);
const AUTH_DIR = path.join(OUTPUT_DIR, 'auth');
const MEDIA_DIR = path.join(OUTPUT_DIR, 'media');
const META_PATH = path.join(OUTPUT_DIR, 'metadata.json');

const WANT_MEDIA = process.env.NO_MEDIA !== '1';
const TIMEOUT_SECONDS = Number(process.env.TIMEOUT_SECONDS || 180);
const logger = pino({ level: process.env.BAILEYS_LOG_LEVEL || 'silent' });

/** proto.HistorySync.HistorySyncType.INITIAL_STATUS_V3 — inlined; Baileys exports WAProto, not proto. */
const SYNC_INITIAL_STATUS_V3 = 1;

type Viewer = {
    jid: string;
    readAt: number | null;
    deliveredAt: number | null;
    playedAt: number | null;
};

type MyStatus = {
    id: string;
    postedAt: number | null;
    mediaType: 'image' | 'video' | 'text' | 'other';
    caption?: string;
    mimeType?: string;
    mediaFile?: string;
    mediaBytes?: number;
    mediaError?: string;
    /** fileSha256 WhatsApp declared for the plaintext, base64. */
    expectedSha256?: string;
    /** sha256 of what we actually wrote. Mismatch => wrong media resolved. */
    actualSha256?: string;
    shaMatches?: boolean;
    /** Actual views — recipients with a read receipt. Matches the count WhatsApp shows. */
    viewCount: number;
    /** How many devices it reached. Always >= viewCount; NOT the view count. */
    deliveredCount: number;
    viewers: Viewer[];
};

async function main() {
    await fs.mkdir(AUTH_DIR, { recursive: true });

    console.log(`\nMy-status extractor — ${RUN_ID}`);
    console.log(`Output: ${OUTPUT_DIR}`);
    console.log(`Media:  ${WANT_MEDIA ? 'download' : 'skip (NO_MEDIA=1)'}\n`);

    const {
        makeWASocket, DisconnectReason, useMultiFileAuthState,
        isJidStatusBroadcast, downloadMediaMessage,
        fetchLatestBaileysVersion, Browsers,
    } = await import('@whiskeysockets/baileys');

    let waVersion: [number, number, number] = [2, 3000, 1037641644];
    try {
        const fetched = await fetchLatestBaileysVersion();
        if (fetched?.version) waVersion = fetched.version as [number, number, number];
    } catch { /* keep pinned literal */ }

    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

    const statuses = new Map<string, MyStatus>();
    let sock: WASocket;
    let done = false;
    let pending = 0;

    const finish = async () => {
        if (done) return;
        done = true;
        clearTimeout(globalTimeout);

        const list = [...statuses.values()].sort((a, b) => (a.postedAt ?? 0) - (b.postedAt ?? 0));
        await fs.writeFile(META_PATH, JSON.stringify({
            runId: RUN_ID,
            extractedAt: new Date().toISOString(),
            accountJid: sock?.user?.id ?? null,
            statusCount: list.length,
            statuses: list,
        }, null, 2));

        console.log(`\n${'='.repeat(58)}`);
        console.log(`YOUR STATUSES — last 24h (${list.length})`);
        console.log('='.repeat(58));
        for (const s of list) {
            const when = s.postedAt ? new Date(s.postedAt * 1000).toLocaleString() : '?';
            console.log(`\n  ${s.mediaType.toUpperCase()}  ${when}`);
            if (s.caption) console.log(`  caption : ${s.caption.replace(/\n/g, ' ').slice(0, 70)}`);
            console.log(`  views   : ${s.viewCount}   (delivered to ${s.deliveredCount})`);
            if (s.mediaFile) console.log(`  media   : ${s.mediaFile} (${s.mediaBytes} bytes)`);
            else if (s.mediaError) console.log(`  media   : FAILED — ${s.mediaError}`);
        }
        if (!list.length) {
            console.log('\n  (none — post a status, then re-run; WhatsApp expires them after 24h)');
        }
        console.log(`\nMetadata: ${META_PATH}`);
        if (WANT_MEDIA && list.some(s => s.mediaFile)) console.log(`Media:    ${MEDIA_DIR}`);

        try { await sock.logout(); console.log('Logged out — device unlinked.'); } catch { /* already closed */ }
        await fs.rm(AUTH_DIR, { recursive: true, force: true }).catch(() => { });
        process.exit(0);
    };

    const globalTimeout = setTimeout(() => {
        console.warn(`\n[timeout] ${TIMEOUT_SECONDS}s elapsed — writing what we have.`);
        finish().catch(() => process.exit(1));
    }, TIMEOUT_SECONDS * 1000);

    const collect = async (m: WAMessage) => {
        // fromMe is the reliable own-status signal here: history-sync entries carry
        // no participant, so matching by jid/LID does not work.
        if (!m.key.fromMe) return;
        if (!isJidStatusBroadcast(m.key.remoteJid ?? '')) return;
        const id = m.key.id;
        if (!id || statuses.has(id)) return;

        const img = m.message?.imageMessage;
        const vid = m.message?.videoMessage;
        const txt = m.message?.extendedTextMessage?.text ?? m.message?.conversation ?? undefined;

        const viewers: Viewer[] = (m.userReceipt ?? []).map(r => ({
            jid: r.userJid ?? '',
            readAt: r.readTimestamp ? Number(r.readTimestamp) : null,
            deliveredAt: r.receiptTimestamp ? Number(r.receiptTimestamp) : null,
            playedAt: r.playedTimestamp ? Number(r.playedTimestamp) : null,
        }));

        const entry: MyStatus = {
            id,
            postedAt: m.messageTimestamp ? Number(m.messageTimestamp) : null,
            mediaType: img ? 'image' : vid ? 'video' : txt !== undefined ? 'text' : 'other',
            caption: img?.caption ?? vid?.caption ?? txt ?? undefined,
            mimeType: img?.mimetype ?? vid?.mimetype ?? undefined,
            // A "view" is a READ receipt. userReceipt holds every recipient, and
            // deliveredAt is set on all of them — counting the array gives delivery
            // reach (e.g. 279) instead of views (71), which is what WhatsApp shows.
            viewCount: viewers.filter(v => v.readAt).length,
            deliveredCount: viewers.filter(v => v.deliveredAt).length,
            viewers,
        };
        statuses.set(id, entry);
        console.log(`  + ${entry.mediaType} ${id.slice(-8)} views=${entry.viewCount}/${entry.deliveredCount} caption="${(entry.caption ?? '').replace(/\n/g, ' ').slice(0, 40)}"`);

        if (WANT_MEDIA && (img || vid)) {
            pending++;
            try {
                const buf = await downloadMediaMessage(
                    m, 'buffer', {},
                    { logger, reuploadRequest: sock.updateMediaMessage },
                ) as Buffer;
                const ext = (entry.mimeType?.split('/')[1] ?? '').split(';')[0].replace(/[^a-z0-9]/gi, '') || 'bin';
                const file = `${id}.${ext}`;
                await fs.mkdir(MEDIA_DIR, { recursive: true });
                await fs.writeFile(path.join(MEDIA_DIR, file), buf);
                entry.mediaFile = file;
                entry.mediaBytes = buf.length;

                // Guard against resolving the wrong media: compare against the hash
                // WhatsApp itself declared for this message's plaintext.
                const declared = img?.fileSha256 ?? vid?.fileSha256;
                if (declared) {
                    entry.expectedSha256 = Buffer.from(declared).toString('base64');
                    entry.actualSha256 = createHash('sha256').update(buf).digest('base64');
                    entry.shaMatches = entry.expectedSha256 === entry.actualSha256;
                }
                const shaNote = entry.shaMatches === false ? '  ** SHA MISMATCH **'
                    : entry.shaMatches ? '  sha ok' : '';
                console.log(`    downloaded ${file} (${buf.length} bytes)${shaNote}`);
            } catch (e) {
                entry.mediaError = (e as Error).message;
                console.log(`    media failed: ${entry.mediaError}`);
            } finally {
                pending--;
            }
        }
    };

    const startSocket = () => {
        sock = makeWASocket({
            auth: state,
            logger,
            printQRInTerminal: false,
            syncFullHistory: false,
            // Accept ONLY the status phase. Accepting RECENT/FULL would pull tens of
            // thousands of chat messages we have no use for.
            shouldSyncHistoryMessage: (msg: any) => msg?.syncType === SYNC_INITIAL_STATUS_V3,
            browser: Browsers.ubuntu('Chrome'),
            version: waVersion,
        });
        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', async ({ connection, qr, lastDisconnect }) => {
            if (qr) {
                console.log('Scan with WhatsApp -> Settings -> Linked devices -> Link a device:\n');
                qrcodeTerminal.generate(qr, { small: true });
            }
            if (connection === 'open') {
                console.log(`\nConnected as ${sock.user?.id}. Waiting for status sync...\n`);
            }
            if (connection === 'close') {
                const reason = (lastDisconnect?.error as Boom)?.output?.statusCode;
                // 515 = restartRequired: pairing succeeded, rebuild with saved creds.
                if (reason === DisconnectReason.restartRequired && !done) {
                    console.log('Pairing accepted — restarting socket...\n');
                    setTimeout(() => startSocket(), 500);
                    return;
                }
                if (!done) {
                    console.warn(`Connection closed (reason=${reason}).`);
                    done = true;
                    clearTimeout(globalTimeout);
                    await fs.rm(AUTH_DIR, { recursive: true, force: true }).catch(() => { });
                    process.exit(reason === DisconnectReason.loggedOut ? 0 : 1);
                }
            }
        });

        sock.ev.on('messaging-history.set', async (evt: any) => {
            if (evt?.syncType !== SYNC_INITIAL_STATUS_V3) return;
            for (const m of evt.messages ?? []) await collect(m);
            // Media downloads run inline above, so by here everything is on disk.
            if (!pending) setTimeout(() => finish().catch(() => process.exit(1)), 250);
        });
    };

    startSocket();
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
