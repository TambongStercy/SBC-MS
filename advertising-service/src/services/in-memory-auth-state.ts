import type { AuthenticationState, SignalDataTypeMap } from '@whiskeysockets/baileys';

/**
 * Baileys auth state held entirely in memory.
 *
 * Baileys ships useMultiFileAuthState, which writes credentials to disk. For our
 * flow that is a liability with no upside: an extraction links, reads statuses and
 * unlinks within seconds, and creds are never reused between runs. Persisting them
 * would mean live WhatsApp credentials sitting on disk that must be deleted
 * afterwards, and that deletion can fail — the process can crash mid-run, logout
 * can hang before the cleanup line is reached, or the unlink itself can error.
 *
 * Keeping them in memory removes the whole class of problem: nothing to delete,
 * nothing to leak, and process death takes the credentials with it.
 *
 * Do NOT swap this for a disk-backed store to enable reconnect-without-QR without
 * first encrypting at rest. Stored creds grant the ability to act as that user on
 * WhatsApp, which is a materially bigger liability than a password.
 */
export const useInMemoryAuthState = async (): Promise<{
    state: AuthenticationState;
    saveCreds: () => Promise<void>;
}> => {
    // Imported here rather than at module scope: Baileys is ESM-only from 6.7.24,
    // and the rest of this service loads it dynamically for the same reason.
    const { initAuthCreds } = await import('@whiskeysockets/baileys');

    const creds = initAuthCreds();
    const keys: Record<string, Record<string, unknown>> = {};

    return {
        state: {
            creds,
            keys: {
                get: <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => {
                    const bucket = keys[type] ?? {};
                    const out: { [id: string]: SignalDataTypeMap[T] } = {};
                    for (const id of ids) {
                        const value = bucket[id];
                        if (value !== undefined) out[id] = value as SignalDataTypeMap[T];
                    }
                    return out;
                },
                set: (data: Record<string, Record<string, unknown> | null>) => {
                    for (const type of Object.keys(data)) {
                        keys[type] ??= {};
                        for (const id of Object.keys(data[type] ?? {})) {
                            const value = data[type]![id];
                            // null means "forget this key"; Baileys relies on the
                            // delete actually happening, not on storing null.
                            if (value === null || value === undefined) delete keys[type][id];
                            else keys[type][id] = value;
                        }
                    }
                },
            },
        },
        // Nothing to persist. Baileys calls this on every creds.update, so it must
        // exist and must be cheap.
        saveCreds: async () => { },
    };
};
