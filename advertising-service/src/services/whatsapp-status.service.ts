import type { WAMessage, WASocket } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import logger from '../utils/logger';
import { useInMemoryAuthState } from './in-memory-auth-state';

const log = logger.getLogger('WhatsAppStatusService');

/**
 * Reads a diffuseur's OWN WhatsApp statuses from the last 24h, with captions,
 * media and real view counts, from a single short-lived link.
 *
 * Depends on patches/@whiskeysockets+baileys+6.7.18.patch. Stock Baileys cannot do
 * this: three gates each hide the next (the server is never asked for the
 * INITIAL_STATUS_V3 phase, the blob is never downloaded, and the payload is never
 * parsed). See WHATSAPP-STATUS-FINDINGS.md.
 *
 * Sessions are deliberately ephemeral: link, read, unlink. Concurrency is capped by
 * the caller, since the server cannot hold many simultaneous Baileys sockets.
 */

/** proto.HistorySync.HistorySyncType.INITIAL_STATUS_V3 — Baileys exports WAProto, not proto. */
const SYNC_INITIAL_STATUS_V3 = 1;

/** Pinned fallback; fetchLatestBaileysVersion is preferred and usually wins. */
const FALLBACK_WA_VERSION: [number, number, number] = [2, 3000, 1037641644];

export type ExtractedStatus = {
    statusMessageId: string;
    postedAt: Date | null;
    mediaType: 'image' | 'video' | 'text' | 'other';
    caption?: string;
    mimeType?: string;
    /** Only populated when downloadMedia is requested. */
    mediaBuffer?: Buffer;
    mediaSha256?: string;
    /** Read receipts. What WhatsApp shows, and what we pay on. */
    viewCount: number;
    /** Recipients reached. Always >= viewCount. NOT what we pay on. */
    deliveredCount: number;
};

export type ExtractionResult = {
    whatsappLid?: string;
    whatsappPhone?: string;
    statuses: ExtractedStatus[];
};

export type ExtractionHandle = {
    /** Resolves once statuses are read and the socket has been torn down. */
    result: Promise<ExtractionResult>;
    /** Abort early, e.g. the diffuseur closed the page before scanning. */
    cancel: () => void;
};

type ExtractOptions = {
    /** Delivered to the caller so it can be rendered as a QR for the diffuseur. */
    onQr?: (qr: string) => void;
    /**
     * Pair by 8-character code instead of a QR.
     *
     * Diffuseurs link the same phone that is displaying the page, so there is no
     * second screen to point a camera at. WhatsApp's "Lier avec le numéro de
     * téléphone" flow exists for exactly that.
     *
     * E.164 digits, no '+', no spaces.
     */
    pairWithPhone?: string;
    /** The code to type into WhatsApp. Arrives shortly after the socket opens. */
    onPairingCode?: (code: string) => void;
    onConnected?: (info: { lid?: string; phone?: string }) => void;
    /** Media bytes are only needed when we intend to verify the creative. */
    downloadMedia?: boolean;
    /** Hard ceiling. A diffuseur who never scans must not pin a socket open. */
    timeoutMs?: number;
};

const userPart = (jid?: string | null): string => (jid ?? '').split('@')[0].split(':')[0];

/**
 * Numeric value of a protobuf timestamp.
 *
 * Baileys hands these back as Long objects ({ low, high }) rather than numbers,
 * and an unset one is a *present object holding zero* — truthy in a boolean test.
 * Every count derived from these is money, so they are compared numerically.
 */
const epochOf = (value: unknown): number => {
    if (value == null) return 0;
    if (typeof value === 'number') return value;
    if (typeof value === 'string') return Number(value) || 0;

    const long = value as { toNumber?: () => number; low?: number; high?: number };
    if (typeof long.toNumber === 'function') {
        try { return long.toNumber(); } catch { return 0; }
    }
    if (typeof long.low === 'number') {
        return long.low + (long.high ?? 0) * 4294967296;
    }
    return 0;
};

/**
 * Links a WhatsApp account and reads its own statuses.
 *
 * Returns a handle rather than a bare promise because the caller must surface the
 * QR to a waiting user and may need to abort.
 */
export const extractOwnStatuses = (opts: ExtractOptions = {}): ExtractionHandle => {
    const timeoutMs = opts.timeoutMs ?? 3 * 60 * 1000;
    let settle: (r: ExtractionResult) => void;
    let reject: (e: Error) => void;

    const result = new Promise<ExtractionResult>((res, rej) => {
        settle = res;
        reject = rej;
    });

    let sock: WASocket | undefined;
    let done = false;
    let timer: NodeJS.Timeout | undefined;

    /**
     * Credentials live only in memory (see in-memory-auth-state.ts), so there is
     * nothing on disk to clean up here. All this does is unlink the device so SBC
     * does not linger in the diffuseur's WhatsApp.
     *
     * logout() is a network round-trip and can hang, so it is bounded. A hung
     * logout must not keep the socket alive.
     */
    const teardown = async (unlink: boolean) => {
        if (timer) clearTimeout(timer);
        try {
            if (unlink && sock) {
                await Promise.race([
                    sock.logout(),
                    new Promise(r => setTimeout(r, 5000)),
                ]);
            }
        } catch {
            /* socket may already be gone; the end() below is what matters */
        }
        try {
            sock?.end(undefined);
        } catch {
            /* already closed */
        }
    };

    const finish = async (value: ExtractionResult) => {
        if (done) return;
        done = true;
        await teardown(true);
        settle(value);
    };

    const abort = async (err: Error) => {
        if (done) return;
        done = true;
        await teardown(false);
        reject(err);
    };

    void (async () => {
        try {
            const {
                makeWASocket, DisconnectReason,
                isJidStatusBroadcast, downloadMediaMessage,
                fetchLatestBaileysVersion, Browsers,
            } = await import('@whiskeysockets/baileys');

            let waVersion = FALLBACK_WA_VERSION;
            try {
                const fetched = await fetchLatestBaileysVersion();
                if (fetched?.version) waVersion = fetched.version as [number, number, number];
            } catch {
                log.warn('fetchLatestBaileysVersion failed; using pinned version');
            }

            // In-memory, never on disk: an extraction is seconds long and creds are
            // never reused, so persisting them would only create something that has
            // to be deleted afterwards — and that deletion can fail.
            const { state, saveCreds } = await useInMemoryAuthState();

            timer = setTimeout(
                () => void abort(new Error('WhatsApp link timed out')),
                timeoutMs,
            );

            const collected = new Map<string, ExtractedStatus>();

            const collect = async (m: WAMessage) => {
                // fromMe is the reliable own-status signal: history-sync entries carry
                // no participant, so matching by jid or LID does not work here.
                if (!m.key.fromMe) return;
                if (!isJidStatusBroadcast(m.key.remoteJid ?? '')) return;
                const id = m.key.id;
                if (!id || collected.has(id)) return;

                const img = m.message?.imageMessage;
                const vid = m.message?.videoMessage;
                const txt = m.message?.extendedTextMessage?.text ?? m.message?.conversation ?? undefined;

                const receipts = m.userReceipt ?? [];
                const entry: ExtractedStatus = {
                    statusMessageId: id,
                    postedAt: m.messageTimestamp ? new Date(Number(m.messageTimestamp) * 1000) : null,
                    mediaType: img ? 'image' : vid ? 'video' : txt !== undefined ? 'text' : 'other',
                    caption: img?.caption ?? vid?.caption ?? txt ?? undefined,
                    mimeType: img?.mimetype ?? vid?.mimetype ?? undefined,
                    // A view is a READ receipt. userReceipt holds every recipient,
                    // so counting the array gives delivery reach rather than views.
                    //
                    // The timestamps arrive as protobuf Longs — objects, and an
                    // object is truthy even when it holds zero. A plain
                    // `filter(r => r.readTimestamp)` therefore counted every
                    // recipient: a status with 13 real views reported 216, exactly
                    // matching its delivered count. Compare the numeric value.
                    viewCount: receipts.filter(r => epochOf(r.readTimestamp) > 0).length,
                    deliveredCount: receipts.filter(r => epochOf(r.receiptTimestamp) > 0).length,
                };

                if (receipts.length) {
                    log.debug(
                        `Status ${id}: ${entry.viewCount} read / ${entry.deliveredCount} delivered `
                        + `of ${receipts.length} recipients`,
                    );
                }

                if (opts.downloadMedia && (img || vid)) {
                    try {
                        entry.mediaBuffer = await downloadMediaMessage(
                            m, 'buffer', {},
                            { logger: pino({ level: 'silent' }), reuploadRequest: sock!.updateMediaMessage },
                        ) as Buffer;
                    } catch (e) {
                        log.warn(`Media download failed for status ${id}: ${(e as Error).message}`);
                    }
                }

                collected.set(id, entry);
            };

            let pairingRequested = false;

            const start = () => {
                sock = makeWASocket({
                    auth: state,
                    logger: pino({ level: process.env.BAILEYS_LOG_LEVEL || 'silent' }) as any,
                    printQRInTerminal: false,
                    syncFullHistory: false,
                    // Accept ONLY the status phase. Accepting RECENT or FULL pulls tens
                    // of thousands of chat messages we have no use for.
                    shouldSyncHistoryMessage: (msg: any) => msg?.syncType === SYNC_INITIAL_STATUS_V3,
                    browser: Browsers.ubuntu('Chrome'),
                    version: waVersion,
                });

                sock.ev.on('creds.update', saveCreds);

                // Pairing-code mode. Requested once, on a socket that has never
                // registered — asking again on the same socket invalidates the
                // code the diffuseur is already typing.
                if (opts.pairWithPhone && !state.creds.registered && !pairingRequested) {
                    pairingRequested = true;
                    // The socket has to finish opening its websocket first; Baileys
                    // rejects the request if it is issued too early.
                    setTimeout(async () => {
                        try {
                            const code = await sock!.requestPairingCode(opts.pairWithPhone!);
                            log.info('Pairing code issued');
                            opts.onPairingCode?.(code);
                        } catch (err) {
                            log.error('Could not request a pairing code:', err);
                            void abort(new Error("Impossible d'obtenir un code de connexion. Réessayez avec le QR code."));
                        }
                    }, 3000);
                }

                sock.ev.on('connection.update', async ({ connection, qr, lastDisconnect }) => {
                    // In pairing-code mode WhatsApp still emits QRs; forwarding them
                    // would swap the screen out from under someone mid-code.
                    if (qr && !opts.pairWithPhone) opts.onQr?.(qr);

                    if (connection === 'open') {
                        opts.onConnected?.({
                            lid: userPart((sock!.user as any)?.lid || state.creds.me?.lid) || undefined,
                            phone: userPart(sock!.user?.id) || undefined,
                        });
                    }

                    if (connection === 'close') {
                        const reason = (lastDisconnect?.error as Boom)?.output?.statusCode;
                        // 515 = restartRequired: pairing succeeded, rebuild with saved creds.
                        if (reason === DisconnectReason.restartRequired && !done) {
                            setTimeout(start, 500);
                            return;
                        }
                        if (!done) {
                            await abort(new Error(`WhatsApp connection closed (reason=${reason})`));
                        }
                    }
                });

                sock.ev.on('messaging-history.set', async (evt: any) => {
                    if (evt?.syncType !== SYNC_INITIAL_STATUS_V3) return;
                    for (const m of evt.messages ?? []) await collect(m);

                    await finish({
                        whatsappLid: userPart((sock!.user as any)?.lid || state.creds.me?.lid) || undefined,
                        whatsappPhone: userPart(sock!.user?.id) || undefined,
                        statuses: [...collected.values()],
                    });
                });
            };

            start();
        } catch (err) {
            await abort(err as Error);
        }
    })();

    return { result, cancel: () => void abort(new Error('Extraction cancelled')) };
};
