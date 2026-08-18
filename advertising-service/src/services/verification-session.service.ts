import { randomUUID } from 'crypto';
import QRCode from 'qrcode';
import { Types } from 'mongoose';
import { extractOwnStatuses, ExtractionResult, ExtractionHandle } from './whatsapp-status.service';
import config from '../config';
import logger from '../utils/logger';

const log = logger.getLogger('VerificationSession');

/**
 * Verification needs the diffuseur present to scan a QR, so it cannot be a
 * background job. This bridges that: HTTP starts a session, the client polls for
 * the QR, scans, and polls again for the result.
 *
 * Sessions are in-memory on purpose. They are seconds long, tied to a live socket
 * owned by this process, and worthless to another instance — persisting them would
 * only invite a second instance to resume something it cannot.
 */

export type SessionState = 'queued' | 'starting' | 'awaiting_scan' | 'reading' | 'done' | 'failed';

export type VerificationSession = {
    id: string;
    diffuseurUserId: string;
    participationId: string;
    day: number;
    state: SessionState;
    /** 1-based place in the waiting line while state is 'queued'. */
    queuePosition?: number;
    qr?: string;
    /** 8-character code to type into WhatsApp, when pairing by phone number. */
    pairingCode?: string;
    method: 'qr' | 'code';
    result?: ExtractionResult;
    error?: string;
    createdAt: Date;
    /** Set when the WhatsApp socket reached "connected". Distinguishes a failure
     *  before the link (pairing/user side) from one during the status read. */
    connectedAt?: Date;
};

const sessions = new Map<string, VerificationSession>();
const handles = new Map<string, ExtractionHandle>();

/** Finished sessions are kept briefly so a slow client can still collect the result. */
const SESSION_TTL_MS = 5 * 60 * 1000;

/**
 * Hard cap on simultaneous WhatsApp sockets. Each one holds an open connection and
 * decodes a full status-sync blob, so this is the number the server's memory can
 * actually carry, not a politeness limit.
 */
const MAX_CONCURRENT = Number(process.env.MAX_CONCURRENT_VERIFICATIONS || 16);

/**
 * How many may wait for a socket before we start turning people away.
 *
 * Measured on preprod: a socket waiting to be scanned costs 5-10MB and no CPU,
 * and most of a session's life is exactly that — the diffuseur finding their
 * phone. So the cap protects the sync bursts, and the queue absorbs a launch
 * night rather than answering 503 to someone who did nothing wrong.
 */
const MAX_QUEUED = Number(process.env.MAX_QUEUED_VERIFICATIONS || 60);

/** FIFO of session ids waiting for a slot. */
const waiting: string[] = [];

let active = 0;

/**
 * Running verification tallies. There is no persistence for sessions, so this is
 * the only way to see the real success-vs-failure rate — the success path used to
 * log nothing at all. `connected` counts sessions whose WhatsApp socket actually
 * linked; comparing it against `succeeded` separates "couldn't link" (pairing/user
 * side) from "linked but the read failed" (our side). Logged as a summary every
 * few minutes; reset only on restart.
 */
const stats = {
    started: 0,
    connected: 0,
    succeeded: 0,
    /** failure count keyed by "<phase>:<reason>", e.g. "after_connect:WhatsApp connection closed". */
    failed: {} as Record<string, number>,
};

const bumpFailure = (key: string) => { stats.failed[key] = (stats.failed[key] || 0) + 1; };

export const verificationStats = () => ({
    ...stats,
    failed: { ...stats.failed },
    totalFailed: Object.values(stats.failed).reduce((a, b) => a + b, 0),
});

export const activeCount = () => active;
export const queuedCount = () => waiting.length;
export const capacityAvailable = () => active < MAX_CONCURRENT;

/** Renumbers the queue so each waiting session can be told where it stands. */
const renumber = () => {
    waiting.forEach((id, i) => {
        const s = sessions.get(id);
        if (s) s.queuePosition = i + 1;
    });
};

const sweep = () => {
    const cutoff = Date.now() - SESSION_TTL_MS;
    for (const [id, s] of sessions) {
        if (s.createdAt.getTime() < cutoff) {
            // Cancel first: a session can age out while its socket is still open,
            // and dropping the map entry alone would leak the slot forever.
            handles.get(id)?.cancel();
            handles.delete(id);
            const q = waiting.indexOf(id);
            if (q !== -1) { waiting.splice(q, 1); renumber(); }
            pending.delete(id);
            sessions.delete(id);
        }
    }
};
setInterval(() => { sweep(); pump(); }, 60 * 1000).unref();

// Rolling summary so the real success/failure rate is visible without persisting
// sessions. Only emitted when something happened since the last tick.
let lastLoggedStarted = 0;
setInterval(() => {
    if (stats.started === lastLoggedStarted) return;
    lastLoggedStarted = stats.started;
    const totalFailed = Object.values(stats.failed).reduce((a, b) => a + b, 0);
    log.info(
        `Verification tally — started ${stats.started}, linked ${stats.connected}, `
        + `succeeded ${stats.succeeded}, failed ${totalFailed} `
        + `(${JSON.stringify(stats.failed)}); active ${active}, queued ${waiting.length}`,
    );
}, 5 * 60 * 1000).unref();

export class NoCapacityError extends Error {
    constructor() {
        super("Beaucoup de vérifications en cours et la file d'attente est pleine. Réessayez dans quelques minutes.");
    }
}

/**
 * Opens a verification session. Returns immediately; the caller polls for the QR.
 *
 * The slot is released in a finally, so a crash, timeout or cancel cannot strand
 * capacity — the failure mode there is a service that silently stops verifying
 * anyone after enough errors.
 */
export const startSession = (args: {
    diffuseurUserId: Types.ObjectId;
    participationId: Types.ObjectId;
    day: number;
    downloadMedia?: boolean;
    /** Set to pair by code instead of QR. E.164 digits, no '+'. */
    pairWithPhone?: string;
}): VerificationSession => {
    if (!capacityAvailable() && waiting.length >= MAX_QUEUED) throw new NoCapacityError();

    const id = randomUUID();
    const session: VerificationSession = {
        id,
        diffuseurUserId: String(args.diffuseurUserId),
        participationId: String(args.participationId),
        day: args.day,
        state: 'starting',
        method: args.pairWithPhone ? 'code' : 'qr',
        createdAt: new Date(),
    };
    sessions.set(id, session);
    pending.set(id, args);

    if (capacityAvailable()) {
        begin(id);
    } else {
        // Waiting costs the diffuseur nothing but patience, and beats being told
        // to come back later with no idea when.
        session.state = 'queued';
        waiting.push(id);
        renumber();
        log.info(`Session ${id} queued at position ${session.queuePosition} (${active} active)`);
    }

    return session;
};

/** Arguments of sessions not yet begun, kept only until their socket opens. */
const pending = new Map<string, {
    diffuseurUserId: Types.ObjectId;
    participationId: Types.ObjectId;
    day: number;
    downloadMedia?: boolean;
    pairWithPhone?: string;
}>();

/** Starts the next queued session, if a slot is free. */
const pump = () => {
    while (capacityAvailable() && waiting.length) {
        const id = waiting.shift()!;
        renumber();
        // It may have aged out or been cancelled while waiting.
        if (sessions.get(id)?.state === 'queued') begin(id);
        else pending.delete(id);
    }
};

/** Opens the WhatsApp socket for a session that holds a slot. */
const begin = (id: string): void => {
    const session = sessions.get(id);
    const args = pending.get(id);
    if (!session || !args) return;
    pending.delete(id);

    session.state = 'starting';
    session.queuePosition = undefined;
    active++;

    const handle = extractOwnStatuses({
        downloadMedia: args.downloadMedia,
        pairWithPhone: args.pairWithPhone,
        onPairingCode: code => {
            session.pairingCode = code;
            session.state = 'awaiting_scan';
        },
        onQr: qr => {
            // Baileys hands over the raw QR payload ("2@...") — not something a
            // browser can render. Convert once here rather than on every poll.
            QRCode.toDataURL(qr)
                .then(dataUrl => { session.qr = dataUrl; })
                .catch(err => {
                    log.error(`Failed to render QR for session ${id}:`, err);
                    session.state = 'failed';
                    session.error = "Impossible d'afficher le code QR.";
                });
            session.state = 'awaiting_scan';
        },
        onConnected: () => {
            session.state = 'reading';
            session.connectedAt = new Date();
            stats.connected++;
            // Both are spent once used; keeping them around only risks showing a
            // dead code to a client that polls late.
            session.qr = undefined;
            session.pairingCode = undefined;
        },
    });
    handles.set(id, handle);

    stats.started++;

    handle.result
        .then(result => {
            session.result = result;
            session.state = 'done';
            stats.succeeded++;
            const secs = ((Date.now() - session.createdAt.getTime()) / 1000).toFixed(1);
            const n = result.statuses?.length ?? 0;
            log.info(
                `Verification session ${id} SUCCEEDED (day ${session.day}, ${session.method}, ${secs}s, `
                + `${n} status(es) read)`,
            );
        })
        .catch((err: Error) => {
            session.error = err.message;
            session.state = 'failed';
            // Whether the socket ever linked is the key split: a failure before it
            // is pairing/user side; after it is the status read on our side.
            const phase = session.connectedAt ? 'after_connect' : 'before_connect';
            bumpFailure(`${phase}:${err.message}`);
            const secs = ((Date.now() - session.createdAt.getTime()) / 1000).toFixed(1);
            log.warn(`Verification session ${id} FAILED [${phase}] (day ${session.day}, ${session.method}, ${secs}s): ${err.message}`);
        })
        .finally(() => {
            // Released the moment this diffuseur's statuses are read, not when
            // they close the sheet — the slot belongs to the socket, not the UI.
            active--;
            handles.delete(id);
            pump();
        });
};

export const getSession = (id: string): VerificationSession | undefined => sessions.get(id);

export const cancelSession = (id: string): void => {
    const queuedAt = waiting.indexOf(id);
    if (queuedAt !== -1) {
        waiting.splice(queuedAt, 1);
        renumber();
        pending.delete(id);
    }
    handles.get(id)?.cancel();
    handles.delete(id);
    const s = sessions.get(id);
    if (s && s.state !== 'done') {
        s.state = 'failed';
        s.error = 'Annulé';
    }
};
