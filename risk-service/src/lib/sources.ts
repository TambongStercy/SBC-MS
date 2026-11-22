import mongoose, { Connection } from 'mongoose';
import { config } from '../config';
import { childLogger } from './logger';

const log = childLogger('Sources');

/**
 * The other services' databases, read-only: users (USERS_MONGODB_URI) and
 * payment (PAYMENT_MONGODB_URI). risk-service never writes to them; it reads
 * the facts behind an event instead of asking the producer to send copies.
 * One lazily opened connection each, closed on shutdown. The checks point them
 * at test databases with `setSource`.
 */
type Name = 'users' | 'payment';
const conns: Record<Name, Connection | null> = { users: null, payment: null };
const uriOf = (name: Name) => (name === 'users' ? config.sources.usersUri : config.sources.paymentUri);

export function sourceDb(name: Name): Connection | null {
    const uri = uriOf(name);
    if (!conns[name] && uri) {
        const c = mongoose.createConnection(uri, { maxPoolSize: 5, readPreference: 'secondaryPreferred' });
        c.on('error', (e) => log.warn({ message: e.message, source: name }, 'source database error'));
        conns[name] = c;
    }
    return conns[name];
}

/** The native collection once connected; null when the source is not configured or unreachable. */
export async function sourceCollection(name: Name, collection: string) {
    const conn = sourceDb(name);
    if (!conn) return null;
    try {
        if (conn.readyState !== 1) await conn.asPromise();
    } catch (e: any) {
        log.warn({ message: e?.message, source: name }, 'source database unreachable');
        return null;
    }
    return conn.db ? conn.db.collection(collection) : null;
}

export function setSource(name: Name, conn: Connection | null) { conns[name] = conn; }

export async function closeSources(): Promise<void> {
    for (const name of ['users', 'payment'] as Name[]) {
        const c = conns[name];
        conns[name] = null;
        if (c) await c.close().catch(() => undefined);
    }
}
