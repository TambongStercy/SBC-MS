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

export type SessionState = 'starting' | 'awaiting_scan' | 'reading' | 'done' | 'failed';

export type VerificationSession = {
    id: string;
    diffuseurUserId: string;
    participationId: string;
    day: number;
    state: SessionState;
    qr?: string;
    result?: ExtractionResult;
    error?: string;
    createdAt: Date;
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
const MAX_CONCURRENT = Number(process.env.MAX_CONCURRENT_VERIFICATIONS || 8);

let active = 0;

export const activeCount = () => active;
export const capacityAvailable = () => active < MAX_CONCURRENT;

const sweep = () => {
    const cutoff = Date.now() - SESSION_TTL_MS;
    for (const [id, s] of sessions) {
        if (s.createdAt.getTime() < cutoff) {
            // Cancel first: a session can age out while its socket is still open,
            // and dropping the map entry alone would leak the slot forever.
            handles.get(id)?.cancel();
            handles.delete(id);
            sessions.delete(id);
        }
    }
};
setInterval(sweep, 60 * 1000).unref();

export class NoCapacityError extends Error {
    constructor() {
        super('Trop de vérifications en cours. Réessayez dans quelques instants.');
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
}): VerificationSession => {
    if (!capacityAvailable()) throw new NoCapacityError();

    const id = randomUUID();
    const session: VerificationSession = {
        id,
        diffuseurUserId: String(args.diffuseurUserId),
        participationId: String(args.participationId),
        day: args.day,
        state: 'starting',
        createdAt: new Date(),
    };
    sessions.set(id, session);
    active++;

    const handle = extractOwnStatuses({
        downloadMedia: args.downloadMedia,
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
            // The QR is spent once scanned; keeping it around only risks it being
            // shown again to a client that polls late.
            session.qr = undefined;
        },
    });
    handles.set(id, handle);

    handle.result
        .then(result => {
            session.result = result;
            session.state = 'done';
        })
        .catch((err: Error) => {
            session.error = err.message;
            session.state = 'failed';
            log.warn(`Verification session ${id} failed: ${err.message}`);
        })
        .finally(() => {
            active--;
            handles.delete(id);
        });

    return session;
};

export const getSession = (id: string): VerificationSession | undefined => sessions.get(id);

export const cancelSession = (id: string): void => {
    handles.get(id)?.cancel();
    handles.delete(id);
    const s = sessions.get(id);
    if (s && s.state !== 'done') {
        s.state = 'failed';
        s.error = 'Annulé';
    }
};
